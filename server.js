import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';

import connectDB from './config/db.js';
import path from 'path';
import authRoutes from './routes/authRoutes.js';
import fs from 'fs';
import usermanagement from './routes/userManagementRoutes.js'
import patnerProfile from './routes/PatnerProfile.js'

import appsettingroutes from './routes/appsetting.js'
import holiday from './routes/Attandance/Holiday.js'
import attandance from './routes/Attandance/Attandance.js'
import employee from './routes/Attandance/Employee.route.js'
import attendanceRequestRoutes from './routes/Attandance/Request.js'
import { startAttendanceCron } from './controllers/attandance/attendanceAutoClose.job.js';
import categoryAdvertisment from './routes/Attandance/categoryAdvertisment.js'
import advertisment from './routes/Attandance/Advertisement.Routes.js'
import payment from './routes/Attandance/Payment.js'
import planRoutes from './routes/plan.js'
import shift from './routes/Attandance/Shift.js'
import './models/Attandance/Holiydaycron.js'
import ExportRoutes from './routes/Attandance/Export/attendanceRoutes.js'
import permissionRoutes from './routes/permissionRoutes.js';
import subscriptionsdata from './routes/Attandance/subscription.routes.js';
import SalesRoute from './routes/Attandance/Sales/Sales.routes.js';
import SalesReoprts from './routes/Attandance/Sales/Sales.Reports.js';
import lunchRoute from './routes/Attandance/BreakRoute.js';
import comapnayAdmin from './routes/Admin/compay.admin.js';
import Bulkcreation from './routes/Admin/bulkCreation.js';
import billedDateRoutes from './routes/BilledDate/billedDate.js';
import attendanceReportRoute from './routes/Attandance/attendanceReportRoutes.js';
import TodayAttendanceRoute from './routes/Attandance/todayAttendanceRoutes.js';
import salesR from './routes/Attandance/Sales/salses.js';
import onboardingRoutes from './routes/onboarding.routes.js';
import bulkUploadSalesRoute from './routes/Attandance/bulkUploadSalesSessions.js'
import './cron/subscription.js';
import './cron/markAbsent.cron.js'
import './cron/markpunchout.cron.js'
dotenv.config();
await connectDB();
// START BACKGROUND WORKER HERE


const app = express();

app.set('view engine', 'ejs');
// Configure CORS (Allow all origins by default)
app.use(cors());

app.use(express.json({ limit: "50mb" }));          // For JSON requests
app.use(express.urlencoded({ limit: "50mb", extended: true })); // For 



// Test route
// ---------------------------
app.get('/', (req, res) => {
  res.send('UAI is Running Smoothly!');
});
app.use(
  "/exports",
  express.static(path.join(process.cwd(), "exports"))
);


app.use('/api/usermanagement', usermanagement);
app.use('/api/permissionRoutes', permissionRoutes);

app.use('/api/holiday', holiday);
app.use('/api/v1/SalesRoute', SalesRoute);
app.use('/api/attendance', attandance);
app.use('/api/employee', employee);
app.use('/api/categoryAdvertisment', categoryAdvertisment);
app.use('/api/advertisements', advertisment);
app.use('/api/ExportRoutes', ExportRoutes);
app.use('/api/v1/sales/reports', SalesReoprts);
app.use('/api/break', lunchRoute);
// API routes
app.use('/api/plan', planRoutes);
app.use('/api/appsetting', appsettingroutes);
app.use('/api/auth', authRoutes);
app.use('/api/shift', shift);
app.use('/api/payment', payment);
app.use('api/v1/bulk/upload/SalesRoute',bulkUploadSalesRoute)
app.use("/api/attendance/requests", attendanceRequestRoutes);
app.use('/api/patnerProfile', patnerProfile);
app.use('/api/subscriptionsdata', subscriptionsdata);
app.use('/api/billedDate', billedDateRoutes);
app.use('/api/admin/company', comapnayAdmin);
app.use('/api/admin/bulk', Bulkcreation);
app.use('/api/attendance/report', attendanceReportRoute);
app.use('/api/salesR', salesR);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/today/pi', TodayAttendanceRoute);

// Add this after your existing middleware setup
app.use('/uploads', express.static('uploads'));

// Create uploads directory if it doesn't exist
if (!fs.existsSync('uploads/links')) {
  fs.mkdirSync('uploads/links', { recursive: true });
}

// app.get('/link-dashboard', (req, res) => {
//   const filePath = path.resolve('public/linkDashboard.html');
//   res.sendFile(filePath);
// });

// Start server

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);

  // Start cron AFTER server is alive
  startAttendanceCron();
});
