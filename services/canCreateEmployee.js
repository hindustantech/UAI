export const canCreateEmployee = (subscription) => {
    const limitFeature = subscription.planSnapshot.features.find(
        f => f.key === "MAXEMPLOYEES"
    );

    const limit = limitFeature?.value || 0;

    return subscription.usage.employeesUsed < limit;
};