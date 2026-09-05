# Plan: Add gender, dob, email validation to completeSalesForm

## File to edit
`controllers\attandance\Sales\Sales.js`

## Change
Insert validation for `gender`, `dob`, and `email` after the `isActive` validation block (line 697) in `completeSalesForm`.

### Current code (lines 694-705):
```js
    // isActive validation (only check type if it's actually provided)
    if (isActive !== undefined && typeof isActive !== "boolean") {
      errors.isActive = "isActive must be a boolean value";
    }

    if (Object.keys(errors).length > 0) {
```

### New code:
```js
    // isActive validation (only check type if it's actually provided)
    if (isActive !== undefined && typeof isActive !== "boolean") {
      errors.isActive = "isActive must be a boolean value";
    }

    // Gender validation (optional - validate if provided)
    if (gender !== undefined && gender !== null && gender.trim() !== "") {
      const allowedGenders = ["Male", "Female", "Other"];
      if (!allowedGenders.includes(gender)) {
        errors.gender = `Invalid gender. Must be one of: ${allowedGenders.join(", ")}`;
      }
    }

    // DOB validation (optional - validate if provided and must not be future date)
    if (dob !== undefined && dob !== null && dob.trim() !== "") {
      const dobDate = new Date(dob);
      if (isNaN(dobDate.getTime())) {
        errors.dob = "Invalid date format";
      } else if (dobDate > new Date()) {
        errors.dob = "DOB cannot be a future date";
      }
    }

    // Email validation (optional - no format validation per request)
    // email field accepted as-is, no validation applied

    if (Object.keys(errors).length > 0) {
```

## Summary of changes
- **gender**: When provided, validates against enum `["Male", "Female", "Other"]` (matches Mongoose model)
- **dob**: When provided, validates it's a valid date and not in the future
- **email**: No validation (per user request) - any string accepted
- All three fields remain **optional** - only validated when present with a non-empty value
