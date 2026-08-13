// Human-readable case folders in Odin, with core:testing.
//
//   make test-cases
//   make test-case CASE=overdue_invoice_fees
//   make debug-case CASE=overdue-invoice-fees      (see case_debug.odin)
//
// Odin has no runtime test registration, so each case gets a three-line @(test)
// proc that delegates to run_and_compare. That is the one place this pattern
// costs more than in Python or TypeScript, and it buys something back: the case
// name is a symbol, so `-define:ODIN_TEST_NAMES=...` and the debugger both find
// it by name.
//
// Memory: everything the runner allocates comes from context.temp_allocator and
// is freed in one call at the end of the test, so a case cannot leak into the
// next one. Run with -define:ODIN_TEST_TRACK_MEMORY=true to prove it.

package billing_cases

import "core:encoding/json"
import "core:fmt"
import "core:os"
import "core:path/filepath"
import "core:strconv"
import "core:strings"
import "core:testing"

import billing "../src/billing/domain"

CASES_ROOT :: "tests/cases"
INPUTS_DIR :: "inputs"
OUTPUTS_DIR :: "outputs"

Case_Document :: struct {
	file_name: string,
	content:   string,
}

Case_Error :: enum {
	None,
	Missing_Input,
	Malformed_Input,
	Missing_Baseline,
}

// --- the tests: one per case folder, three lines each ------------------------

@(test)
test_overdue_invoice_fees :: proc(t: ^testing.T) {
	run_and_compare(t, "overdue-invoice-fees")
}

// @(test)
// test_partial_refund_ordering :: proc(t: ^testing.T) {
// 	run_and_compare(t, "partial-refund-ordering")
// }

// --- the shared machinery ----------------------------------------------------

run_and_compare :: proc(t: ^testing.T, case_name: string) {
	defer free_all(context.temp_allocator)

	case_dir := filepath.join({CASES_ROOT, case_name}, context.temp_allocator)

	readme := filepath.join({case_dir, "README.md"}, context.temp_allocator)
	testing.expectf(t, os.exists(readme), "%s has no README.md", case_name)

	documents, err := run_case(case_dir, context.temp_allocator)
	testing.expectf(t, err == .None, "%s: running the case failed with %v", case_name, err)
	if err != .None {return}

	for document in documents {
		baseline_path := filepath.join({case_dir, OUTPUTS_DIR, document.file_name}, context.temp_allocator)
		raw, ok := os.read_entire_file(baseline_path, context.temp_allocator)
		if !testing.expectf(t, ok, "%s: no baseline %s", case_name, document.file_name) {continue}

		expected := strings.trim_right_space(string(raw))
		actual := strings.trim_right_space(document.content)

		// One expectation per output file, so the failure names the file that broke.
		testing.expectf(
			t,
			actual == expected,
			"%s :: %s\n--- expected ---\n%s\n--- actual ---\n%s",
			case_name,
			document.file_name,
			expected,
			actual,
		)
	}
}

// inputs/ on disk -> the output documents this case expects.
// No testing import is used here on purpose: case_debug.odin calls this same
// proc with a debugger attached and no test runner on the stack.
run_case :: proc(case_dir: string, allocator := context.allocator) -> (documents: []Case_Document, err: Case_Error) {
	inputs := filepath.join({case_dir, INPUTS_DIR}, allocator)

	invoices := read_json([]billing.Invoice, filepath.join({inputs, "invoices.json"}, allocator), allocator) or_return
	policy := read_json(billing.Late_Fee_Policy, filepath.join({inputs, "policy.json"}, allocator), allocator) or_return
	as_of_doc := read_json(As_Of, filepath.join({inputs, "as_of.json"}, allocator), allocator) or_return
	as_of := parse_date(as_of_doc.as_of_date) or_return

	assessment := billing.assess_late_fees(invoices, policy, as_of, allocator)

	out := make([dynamic]Case_Document, 0, 2, allocator)
	append(&out, Case_Document{"assessed_fees.json", to_canonical_json(assessment.assessed, allocator) or_return})
	append(&out, Case_Document{"skipped.json", to_canonical_json(assessment.skipped, allocator) or_return})
	return out[:], .None
}

As_Of :: struct {
	as_of_date: string `json:"as_of_date"`,
}

read_json :: proc($T: typeid, path: string, allocator := context.allocator) -> (value: T, err: Case_Error) {
	raw, ok := os.read_entire_file(path, allocator)
	if !ok {return value, .Missing_Input}
	if json.unmarshal(raw, &value, json.DEFAULT_SPECIFICATION, allocator) != nil {
		return value, .Malformed_Input
	}
	return value, .None
}

// Canonical form: pretty-printed, two spaces, so a failure diff shows the one
// field that changed rather than a reflow.
to_canonical_json :: proc(value: any, allocator := context.allocator) -> (text: string, err: Case_Error) {
	options := json.Marshal_Options {
		pretty     = true,
		use_spaces = true,
		spaces     = 2,
	}
	bytes, marshal_err := json.marshal(value, options, allocator)
	if marshal_err != nil {return "", .Malformed_Input}
	return string(bytes), .None
}

parse_date :: proc(text: string) -> (date: billing.Date, err: Case_Error) {
	parts := strings.split(text, "-", context.temp_allocator)
	if len(parts) != 3 {return date, .Malformed_Input}

	year, year_ok := strconv.parse_int(parts[0])
	month, month_ok := strconv.parse_int(parts[1])
	day, day_ok := strconv.parse_int(parts[2])
	if !year_ok || !month_ok || !day_ok {return date, .Malformed_Input}

	return billing.Date{year = year, month = month, day = day}, .None
}
