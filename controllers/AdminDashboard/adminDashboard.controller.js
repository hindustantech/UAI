import User from "../../models/userModel.js";
import Subscription from "../models/Attandance/subscration/Subscription.js";
import PaymentLog from "../models/Attandance/subscration/PaymentLog.js";
import AuditLog from "../models/AuditLog.js";
import { ValidationError } from "../services/audit/queryBuilder.js";

const sendError = (res, err, fallback = "Dashboard data failed") => {
    if (err instanceof ValidationError) {
        return res.status(400).json({ success: false, message: err.message });
    }
    console.error("ADMIN DASHBOARD ERROR:", err);
    return res.status(500).json({ success: false, message: fallback });
};

/* ────────────────────────────────────────────────────────────────
   DATE HELPERS
   ──────────────────────────────────────────────────────────────── */

const DAY_MS = 86400000;

/** Bucket granularity: monthly when range > 60 days, else daily */
const resolveGranularity = (from, to) =>
    (to.getTime() - from.getTime()) > 60 * DAY_MS ? "month" : "day";

/**
 * Build a contiguous list of [start, end) buckets covering [from, to].
 * Monthly buckets align to from-date + i months; daily buckets to midnight steps.
 * Capped: 24 months / 120 days to protect the DB.
 */
const buildBuckets = (from, to, granularity) => {
    const buckets = [];
    if (granularity === "month") {
        const max = 24;
        let cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
        while (cursor < to && buckets.length < max) {
            const next = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
            buckets.push({ start: new Date(cursor), end: new Date(next), label: cursor.toLocaleString("en", { month: "short" }) });
            cursor = next;
        }
    } else {
        const max = 120;
        let cursor = new Date(from);
        // normalize to UTC midnight
        cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate()));
        while (cursor < to && buckets.length < max) {
            const next = new Date(cursor.getTime() + DAY_MS);
            buckets.push({
                start: new Date(cursor),
                end: new Date(next),
                label: cursor.toLocaleDateString("en", { month: "short", day: "numeric" }),
            });
            cursor = next;
        }
    }
    return buckets;
};

/* ────────────────────────────────────────────────────────────────
   KPIs — each returns { value, delta } where delta compares the
   selected window against the immediately preceding equal window.
   ──────────────────────────────────────────────────────────────── */

const pctDelta = (current, previous) => {
    if (!previous) return current > 0 ? 100 : 0;
    return Number((((current - previous) / previous) * 100).toFixed(1));
};

async function kpiTotalUsers(from, to, priorFrom, priorTo) {
    const [current, previous] = await Promise.all([
        User.countDocuments({ createdAt: { $gte: from, $lte: to } }),
        User.countDocuments({ createdAt: { $gte: priorFrom, $lt: priorTo } }),
    ]);
    const total = await User.countDocuments({});
    return {
        value: total,
        windowNew: current,
        delta: pctDelta(current, previous),
    };
}

async function kpiActiveSubscriptions() {
    const now = new Date();
    const value = await Subscription.countDocuments({
        status: "ACTIVE",
        isActive: true,
        endDate: { $gt: now },
    });
    return { value, delta: null };
}

async function kpiRevenue(from, to, priorFrom, priorTo) {
    const sumPipeline = (match) => [
        { $match: match },
        { $group: { _id: null, total: { $sum: { $ifNull: ["$amount", "$payment.amountPaid"] } } } },
    ];

    const [currentAgg, previousAgg] = await Promise.all([
        PaymentLog.aggregate(sumPipeline({
            status: "SUCCESS",
            paymentCompletedAt: { $gte: from, $lte: to },
        })),
        PaymentLog.aggregate(sumPipeline({
            status: "SUCCESS",
            paymentCompletedAt: { $gte: priorFrom, $lt: priorTo },
        })),
    ]);

    const current = currentAgg[0]?.total ?? 0;
    const previous = previousAgg[0]?.total ?? 0;

    return { value: current, delta: pctDelta(current, previous) };
}

async function kpiGrowthRate(from, to, priorFrom, priorTo) {
    // New users as % of base users before the window started
    const [newUsers, baseUsers] = await Promise.all([
        User.countDocuments({ createdAt: { $gte: from, $lte: to } }),
        User.countDocuments({ createdAt: { $lt: from } }),
    ]);
    const value = baseUsers > 0 ? Number(((newUsers / baseUsers) * 100).toFixed(1)) : 0;

    const [prevNewUsers] = await Promise.all([
        User.countDocuments({ createdAt: { $gte: priorFrom, $lt: priorTo } }),
    ]);
    const prevValue = baseUsers > 0 ? Number(((prevNewUsers / baseUsers) * 100).toFixed(1)) : 0;

    return { value, delta: Number((value - prevValue).toFixed(1)) };
}

/* ────────────────────────────────────────────────────────────────
   SERIES — single aggregation per chart using $dateToString buckets
   ──────────────────────────────────────────────────────────────── */

function seriesGroupStage(granularity) {
    return granularity === "month"
        ? { $dateToString: { format: "%Y-%m", date: "$createdAt" } }
        : { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } };
}

function revenueSeriesGroupStage(granularity) {
    return granularity === "month"
        ? { $dateToString: { format: "%Y-%m", date: "$paymentCompletedAt" } }
        : { $dateToString: { format: "%Y-%m-%d", date: "$paymentCompletedAt" } };
}

const labelForKey = (key, granularity) => {
    if (!key) return "";
    if (granularity === "month") {
        const [y, m] = key.split("-");
        return new Date(Date.UTC(Number(y), Number(m) - 1, 1)).toLocaleString("en", { month: "short" });
    }
    const d = new Date(key + "T00:00:00Z");
    return d.toLocaleDateString("en", { month: "short", day: "numeric" });
};

async function revenueSeries(from, to, granularity) {
    const rows = await PaymentLog.aggregate([
        { $match: { status: "SUCCESS", paymentCompletedAt: { $gte: from, $lte: to } } },
        {
            $group: {
                _id: revenueSeriesGroupStage(granularity),
                revenue: { $sum: { $ifNull: ["$amount", 0] } },
            },
        },
        { $sort: { _id: 1 } },
    ]);

    const map = Object.fromEntries(rows.map(r => [r._id, r.revenue]));
    return buildBuckets(from, to, granularity).map(b => {
        const key = granularity === "month"
            ? `${b.start.getUTCFullYear()}-${String(b.start.getUTCMonth() + 1).padStart(2, "0")}`
            : b.start.toISOString().slice(0, 10);
        return { label: b.label, revenue: map[key] ?? 0 };
    });
}

async function userGrowthSeries(from, to, granularity) {
    const rows = await User.aggregate([
        { $match: { createdAt: { $gte: from, $lte: to } } },
        { $group: { _id: seriesGroupStage(granularity), users: { $sum: 1 } } },
        { $sort: { _id: 1 } },
    ]);

    const map = Object.fromEntries(rows.map(r => [r._id, r.users]));
    return buildBuckets(from, to, granularity).map(b => {
        const key = granularity === "month"
            ? `${b.start.getUTCFullYear()}-${String(b.start.getUTCMonth() + 1).padStart(2, "0")}`
            : b.start.toISOString().slice(0, 10);
        return { label: b.label, users: map[key] ?? 0 };
    });
}

/* ────────────────────────────────────────────────────────────────
   RECENT USERS — latest 8 enriched with active plan name
   ──────────────────────────────────────────────────────────────── */

async function recentUsers(limit = 8) {
    const now = new Date();
    const users = await User.find({})
        .select("name email suspend accountStatus")
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();

    return Promise.all(users.map(async (u) => {
        const sub = await Subscription.findOne({
            company: u._id,
            status: "ACTIVE",
            isActive: true,
            endDate: { $gt: now },
        }).sort({ startDate: -1 }).select("planSnapshot.name").lean();

        return {
            _id: u._id,
            name: u.name ?? "—",
            email: u.email ?? "",
            plan: sub?.planSnapshot?.name || "Free",
            status: (u.suspend || u.accountStatus === "SUSPENDED") ? "Blocked" : "Active",
        };
    }));
}

/* ────────────────────────────────────────────────────────────────
   RECENT AUDIT LOGS — latest 6 (actor / action / target)
   ──────────────────────────────────────────────────────────────── */

async function recentAuditLogs(limit = 6) {
    const logs = await AuditLog.find({ visibilityStatus: { $ne: "HIDDEN" } })
        .populate("userId", "name")
        .sort({ timestamp: -1 })
        .limit(limit)
        .select("action resource resourceId userId userRole timestamp")
        .lean();

    return logs.map(log => ({
        userName: log.userId?.name ?? log.userRole ?? "system",
        action: log.action,
        target: log.resourceId && log.resourceId !== "N/A"
            ? `${log.resource}:${log.resourceId}`.slice(0, 40)
            : (log.resource ?? "—"),
        timestamp: log.timestamp,
    }));
}

/* ────────────────────────────────────────────────────────────────
   MAIN HANDLER — GET /api/admin-dashboard/stats?from=&to=
   ──────────────────────────────────────────────────────────────── */

export const getAdminDashboardStats = async (req, res) => {
    try {
        /* Date parsing + validation (strict UTC) */
        const now = new Date();

        let to = req.query.to ? new Date(req.query.to) : now;
        let from = req.query.from ? new Date(req.query.from) : new Date(to.getTime() - 30 * DAY_MS);

        if (isNaN(from.getTime())) throw new ValidationError('Invalid "from" date');
        if (isNaN(to.getTime())) throw new ValidationError('Invalid "to" date');
        if (from > to) throw new ValidationError('"from" must not be after "to"');

        /* Prior equal-length window for deltas */
        const spanMs = to.getTime() - from.getTime();
        const priorTo = new Date(from.getTime());
        const priorFrom = new Date(from.getTime() - spanMs);

        const granularity = resolveGranularity(from, to);

        const [
            usersKpi,
            subsKpi,
            revenueKpi,
            growthKpi,
            revenueData,
            userData,
            recentUserData,
            recentLogs,
        ] = await Promise.all([
            kpiTotalUsers(from, to, priorFrom, priorTo),
            kpiActiveSubscriptions(),
            kpiRevenue(from, to, priorFrom, priorTo),
            kpiGrowthRate(from, to, priorFrom, priorTo),
            revenueSeries(from, to, granularity),
            userGrowthSeries(from, to, granularity),
            recentUsers(8),
            recentAuditLogs(6),
        ]);

        return res.status(200).json({
            success: true,
            message: "Admin dashboard data fetched successfully",
            data: {
                currency: "INR",
                range: { from: from.toISOString(), to: to.toISOString(), granularity },

                kpis: {
                    totalUsers: usersKpi,
                    activeSubscriptions: subsKpi,
                    revenue: revenueKpi,
                    growthRate: growthKpi,
                },

                revenueSeries: revenueData,
                userGrowthSeries: userData,

                recentUsers: recentUserData,
                recentAuditLogs: recentLogs,
            },
        });
    } catch (err) {
        return sendError(res, err);
    }
};