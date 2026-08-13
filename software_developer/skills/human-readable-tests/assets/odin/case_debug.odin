// tools/case_debug/case_debug.odin — the debug entry point.
//
// A tiny executable that runs exactly one case folder, so a developer can put a
// breakpoint in the domain proc and land there with nothing from the test runner
// on the stack. This is the fastest way to learn an unfamiliar Odin package.
//
//   odin build tools/case_debug -debug -out:build/case_debug.exe
//   build/case_debug.exe overdue-invoice-fees
//   make debug-case CASE=overdue-invoice-fees
//
// Then attach RAD Debugger / gdb / lldb, or in VS Code with the CodeLLDB or
// C/C++ extension:
//   { "name": "Debug: one human-readable case", "type": "cppvsdbg",
//     "request": "launch", "program": "${workspaceFolder}/build/case_debug.exe",
//     "args": ["${input:caseName}"], "cwd": "${workspaceFolder}" }
//
// -debug is not optional: without it there are no line numbers and the whole
// point of this executable is lost.

package case_debug

import "core:fmt"
import "core:mem"
import "core:os"

import cases "../../tests"

DEFAULT_CASE :: "overdue-invoice-fees"

main :: proc() {
	// A tracking allocator here as well as in the tests: stepping through a case
	// is also when you notice the leak.
	tracker: mem.Tracking_Allocator
	mem.tracking_allocator_init(&tracker, context.allocator)
	defer mem.tracking_allocator_destroy(&tracker)
	context.allocator = mem.tracking_allocator(&tracker)

	case_name := DEFAULT_CASE
	if len(os.args) > 1 {case_name = os.args[1]}

	fmt.printfln("--- %s ---", case_name)

	// Breakpoint here, then step into billing.assess_late_fees. Each iteration of
	// its loop is one row of the case README's walkthrough, in the same order.
	documents, err := cases.run_case(fmt.tprintf("tests/cases/%s", case_name))
	if err != .None {
		fmt.eprintfln("case failed to run: %v", err)
		os.exit(1)
	}

	for document in documents {
		fmt.printfln("== %s ==\n%s", document.file_name, document.content)
	}

	for _, leak in tracker.allocation_map {
		fmt.eprintfln("leaked %v bytes at %v", leak.size, leak.location)
	}
}
