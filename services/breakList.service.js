const BREAK_STATUS_RANK = {
    on_break: 0,
    break_taken: 1,
    no_break: 2,
    not_checked_in: 3
};

function minutesBetween(from, to) {
    const start = new Date(from).getTime();
    const end = new Date(to).getTime();

    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return 0;
    }

    return Math.floor((end - start) / 60000);
}

export function buildEmployeeBreakState(employee, attendance, now = new Date()) {
    const breaks = Array.isArray(attendance?.breaks) ? attendance.breaks : [];
    const activeBreak = breaks.find(item => item.status === 'active') || null;
    const completedBreaks = breaks.filter(item => item.status === 'completed');

    const totalBreakMinutes = breaks.reduce(
        (total, item) => total + (item.durationMinutes || 0),
        0
    );

    const totalBreakExceededMinutes = breaks.reduce(
        (total, item) => total + (item.exceededMinutes || 0),
        0
    );

    const hasBreak = breaks.length > 0;
    const onBreak = Boolean(activeBreak);

    let breakStatus;
    if (onBreak) {
        breakStatus = 'on_break';
    } else if (hasBreak) {
        breakStatus = 'break_taken';
    } else if (attendance && attendance.punchIn) {
        breakStatus = 'no_break';
    } else {
        breakStatus = 'not_checked_in';
    }

    return {
        employeeId: employee?._id ?? null,
        userId: employee?.userId?._id ?? employee?.userId ?? null,
        employeeName: employee?.user_name || employee?.userId?.name || 'N/A',
        empCode: employee?.empCode || 'N/A',
        department: employee?.jobInfo?.department || 'N/A',
        designation: employee?.jobInfo?.designation || 'N/A',
        profileImage: employee?.userId?.profileImage || null,
        employeeType: employee?.employeeType || null,
        shiftName: employee?.shift?.shiftName || null,
        punchIn: attendance?.punchIn || null,
        punchOut: attendance?.punchOut || null,
        attendanceStatus: attendance?.status || null,
        breakStatus,
        hasBreak,
        onBreak,
        activeBreak: activeBreak
            ? {
                breakName: activeBreak.breakName || activeBreak.type || 'Break',
                type: activeBreak.type || null,
                startTime: activeBreak.startTime || null,
                allowedMinutes: activeBreak.allowedMinutes || 0,
                elapsedMinutes: minutesBetween(activeBreak.startTime, now),
                isPaid: Boolean(activeBreak.isPaid)
            }
            : null,
        completedBreaks: completedBreaks.length,
        totalBreakMinutes,
        totalBreakExceededMinutes
    };
}

export function sortBreakList(employees) {
    return [...employees].sort((a, b) => {
        const rankDiff =
            (BREAK_STATUS_RANK[a.breakStatus] ?? 99) -
            (BREAK_STATUS_RANK[b.breakStatus] ?? 99);

        if (rankDiff !== 0) return rankDiff;

        return String(a.employeeName).localeCompare(String(b.employeeName));
    });
}

export { BREAK_STATUS_RANK };
