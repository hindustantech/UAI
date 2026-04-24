// utils/dateRangeResolver.js

export const resolveDateRange = (fromDate, toDate) => {

    let start;
    let end;
    /* =====================================
       AUTO MODE (No Dates Provided)
       Today → Last 31 Days
    ====================================== */
    if (!fromDate && !toDate) {

        end = new Date(); // today

        start = new Date();
        start.setDate(end.getDate() - 30); // inclusive 31 days

    } else {

        if (!fromDate || !toDate) {
            throw new Error("Both fromDate and toDate must be provided");
        }

        start = new Date(fromDate);
        end = new Date(toDate);

        if (start > end) {
            throw new Error("fromDate cannot be greater than toDate");
        }

        const diffTime = Math.abs(end - start);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays > 31) {
            throw new Error("Date range cannot exceed 31 days");
        }
    }

    // Normalize time boundaries (important for indexing)
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    return { start, end };
};