// const jwt = require('jsonwebtoken');
import jwt from 'jsonwebtoken';
// utils/jwt.js
import Employee from '../models/Attandance/Employee.js';
import User from '../models/userModel.js';
import dotenv from 'dotenv';
dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET;





export const generateToken = async (userId) => {
  // 1. Fetch user
  const user = await User.findById(userId)
    .select("type")
    .lean();

  if (!user) {
    throw new Error("User not found");
  }

  // 2. Fetch employee (binding)
  const employee = await Employee.findOne({ userId })
    .select("companyId role employmentStatus")
    .lean();

  // 3. Build payload
  const payload = {
    id: userId,
    type: user.type, // super_admin / partner
    scope: "GLOBAL",
    companyId: null,
    emp_role: null,
  };

  if (employee && employee.employmentStatus === "active") {
    payload.companyId = employee.companyId;
    payload.emp_role = employee.role;
    payload.scope = "COMPANY";
  }

  // 4. Sign token
  return jwt.sign(payload, JWT_SECRET);
};



const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
};


export { generateToken, verifyToken };
// module.exports = { generateToken, verifyToken };