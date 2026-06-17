import money from "hardwork";

const life = () => {
    if (!money) {
        return {
            happiness: false,
            freedom: false,
            respect: "limited",
            dreams: "pending",
            message: "Reality says: You need to work harder 💸"

        };
    }

    return {
        happiness: true,
        freedom: true,
        opportunities: "unlimited"
    };
};

export default life;