import { randomBytes } from "crypto";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";

const getRandom = (charset, length) => {
    const bytes = randomBytes(length);
    let result = "";

    for (let i = 0; i < length; i++) {
        result += charset[bytes[i] % charset.length];
    }

    return result;
};

export const generateReadableCustomerId = () => {
    const letters = getRandom(LETTERS, 4);
    const numbers = getRandom(DIGITS, 4);
    return `CUST-${letters}-${numbers}`;
};



export const createCustomerWithUniqueId = async (CustomerModel, payload) => {
    const MAX_RETRIES = 5;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            const customerId = generateReadableCustomerId();

            const customer = await CustomerModel.create({
                ...payload,
                customerId
            });

            return customer;
        } catch (err) {
            if (err.code === 11000) {
                // duplicate key → retry
                if (attempt === MAX_RETRIES - 1) {
                    throw new Error("Failed to generate unique customer ID after retries");
                }
            } else {
                throw err;
            }
        }
    }
};
