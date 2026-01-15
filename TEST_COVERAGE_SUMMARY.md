# Test Coverage Summary

## New Tests Added

### 1. `tests/timeFrameDetector.test.ts` (NEW)
Tests for the time frame detection functionality that determines which price-based time frame (cheapest, standard, or expensive) the current time belongs to.

**Coverage:**
- ✅ `detectTimeFrame()` function - main export
- ✅ Detection of cheapest time frame
- ✅ Detection of expensive time frame  
- ✅ Detection of standard time frame
- ✅ Handling of invalid quarter-hour indices
- ✅ Different days of the week
- ✅ Different timezones (UTC, Europe/Berlin)
- ✅ Priority handling (cheapest over expensive)

**Test Cases:**
- Detects cheapest time frame when schedule value matches
- Detects expensive time frame when schedule value matches
- Detects standard time frame when schedule value is default
- Returns standard for invalid quarter-hour index (negative)
- Returns standard for invalid quarter-hour index (>= 96)
- Handles different days correctly
- Handles UTC timezone correctly
- Prioritizes cheapest over expensive when values match

### 2. `tests/kostalApi.test.ts` (UPDATED)
Added tests for the new `setMinHomeConsumption()` function.

**Coverage:**
- ✅ `setMinHomeConsumption()` function
- ✅ Correct payload structure (only updates Battery:MinHomeComsumption)
- ✅ Different value handling (50W, 5000W, etc.)
- ✅ API error handling

**Test Cases:**
- Sends correct payload to update only MinHomeComsumption
- Handles different values correctly
- Handles API errors

## Files Covered by Tests

### New Files:
- ✅ `logic/utils/timeFrameDetector.ts` - **Fully tested**

### Updated Files:
- ✅ `logic/kostalApi/apiClient.ts` - **New function tested** (`setMinHomeConsumption`)

## Files Not Covered (Expected)

### Device Files:
- `drivers/kostal-battery/device.ts` - Not in coverage collection (Homey device, requires Homey runtime)
  - Contains `checkAndUpdateMinHomeConsumption()` method
  - Contains `getCurrentTimeFrameValue()` method
  - Contains `startMinHomeConsumptionChecks()` method
  - **Note:** These methods integrate with Homey APIs and would require mocking the entire Homey runtime to test properly.

## Coverage Configuration

The Jest configuration (`jest.config.cjs`) collects coverage from:
- `logic/**/*.ts` (excludes test files and node_modules)

This means:
- ✅ `logic/utils/timeFrameDetector.ts` - **Covered**
- ✅ `logic/kostalApi/apiClient.ts` - **Covered** (including new `setMinHomeConsumption` function)
- ❌ `drivers/kostal-battery/device.ts` - **Not covered** (outside `logic/` directory, requires Homey runtime)

## Running Tests

To run tests with coverage:

```bash
npm test -- --coverage
```

This will generate:
- Text coverage report in terminal
- HTML coverage report in `coverage/index.html`
- LCOV coverage report in `coverage/lcov.info`

## Expected Coverage Results

After running tests, you should see:

1. **timeFrameDetector.ts**: ~100% coverage
   - All exported functions tested
   - All edge cases covered

2. **apiClient.ts**: Increased coverage
   - `setMinHomeConsumption()` function fully tested
   - Existing functions maintain their coverage

3. **Overall logic/ directory**: Improved coverage
   - New functionality is tested
   - No regressions in existing tests

## Notes

- The device-level integration (`device.ts`) is intentionally not tested as it requires the Homey runtime environment
- All pure logic functions are covered by unit tests
- Integration testing would require a Homey test environment setup
