// services/featureAccess.service.js

export const hasFeatureAccess = (subscription, featureKey) => {
    if (!subscription) return false;

    const feature = subscription.planSnapshot.features.find(
        f => f.key === featureKey
    );

    return feature ? feature.value : false;
};