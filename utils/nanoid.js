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

// Retry-safe ID generator (NO DB write here)
export const generateUniqueCustomerIdWithRetry = async (SalesSessionModel) => {
  const MAX_RETRIES = 5;

  for (let i = 0; i < MAX_RETRIES; i++) {
    const customerId = generateReadableCustomerId();

    const exists = await SalesSessionModel.findOne({
      "customer.customerId": customerId
    });

    if (!exists) return customerId;

    if (i === MAX_RETRIES - 1) {
      throw new Error("Failed to generate unique customer ID");
    }
  }
};