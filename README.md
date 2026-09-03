# ⚡ Fitness For Life — Backend REST API Server

A secure, high-performance Node.js & Express REST API server built with **MongoDB Atlas**, **Better Auth Session Verification**, **JWT Authentication**, and **Stripe Payment Integration**, designed for deployment on **Vercel Serverless Functions**.

---

## 🔗 Live Links & Repositories

- ⚡ **Backend Live API Server**: [https://fitness-for-life-server.vercel.app/](https://fitness-for-life-server.vercel.app/)
- 🐙 **Backend GitHub Repository**: [https://github.com/kawser0x/fitness-for-life-server](https://github.com/kawser0x/fitness-for-life-server)
- 🌐 **Frontend Live Application**: [https://fitness-for-life-client.vercel.app/](https://fitness-for-life-client.vercel.app/)
- 🐙 **Frontend GitHub Repository**: [https://github.com/kawser0x/Fitness-For-Life-Client](https://github.com/kawser0x/Fitness-For-Life-Client)

---

## ✨ Key Backend Capabilities

### 🔒 Unified Authentication & Authorization Middleware
- **Better Auth Session Support**: Direct verification against MongoDB `session` collection tokens.
- **JWT Token Fallback**: Auto-issuing JWT token fallback (`verifyAuthSession`) for seamless cross-domain API authorization.
- **Role Guards**: `verifyAdmin` and `verifyTrainer` middleware enforcing strict route protection.

### 💳 Stripe Payment & Server-to-Server Checkout Processing
- `/api/create-payment-intent`: Generates Stripe client secrets for checkout initialization.
- `/api/checkout_sessions/success`: Handles server redirects, persists paid bookings into MongoDB, and increments class `bookingCount`.

### 📊 MongoDB Aggregations & Live Visual Analytics
- Real-time aggregation of total revenue ($), active members, class bookings, pending trainer applications, and workout category ratios.
- Dynamic 7-month rolling trajectory calculations for platform growth charts.

---

## 🛠️ Tech Stack

- **Runtime Environment**: [Node.js](https://nodejs.org/) (CommonJS)
- **Web Framework**: [Express.js 5](https://expressjs.com/)
- **Database**: [MongoDB Atlas Native Driver](https://www.mongodb.com/)
- **Authentication**: Better Auth MongoDB Adapter, [JSONWebToken (jsonwebtoken)](https://github.com/auth0/node-jsonwebtoken)
- **Payment Processing**: [Stripe Node SDK](https://stripe.com/)
- **Serverless Hosting**: [Vercel Serverless Functions (@vercel/node)](https://vercel.com/docs/functions)

---

## 📡 API Endpoint Summary

### 👤 User & Role Management
- `POST /api/jwt`: Issues a signed JWT access token for user authorization.
- `GET /api/user/role/:email`: Fetches the live role (`user`, `trainer`, `admin`) for a given user email.
- `GET /api/user/stats/:email`: Returns user-specific total booked classes, saved favorites count, and application status.

### 🏋️ Workout Classes
- `GET /api/classes`: Fetches all approved workout classes (with optional category and search filters).
- `GET /api/classes/:id`: Retrieves detailed class specifications.
- `POST /api/classes`: Trainer endpoint to create a new class (defaults to `"Pending"` status for Admin review).
- `PATCH /api/classes/:id`: Trainer endpoint to update class schedule, pricing, or description.
- `DELETE /api/classes/:id`: Deletes a workout class.
- `GET /api/classes/:id/attendees`: Trainer endpoint to view registered student rosters for a specific class.

### 💳 Bookings & Payments
- `POST /api/user/bookings`: Persists paid booking details into MongoDB and increments `bookingCount`.
- `GET /api/user/bookings/:email`: Fetches all booked classes for a student.

### ❤️ Favorites
- `POST /api/user/favorites/toggle`: Adds or removes a class from user favorites.
- `GET /api/user/favorites/:email`: Retrieves saved favorite classes for a user.

### 🎓 Trainer Applications
- `POST /api/trainer/apply`: Member endpoint to submit a trainer application.
- `GET /api/admin/trainer-applications`: Admin endpoint to view pending trainer applications.
- `PATCH /api/admin/trainer-applications/:id/review`: Admin endpoint to approve (promotes user role to `"trainer"`) or reject applications.

### 💬 Community Forum
- `GET /api/forum`: Fetches all community forum posts with server-side pagination.
- `POST /api/forum`: Trainer/Admin endpoint to publish a new forum article.
- `GET /api/forum/trainer/:email`: Retrieves articles authored by a specific trainer.
- `POST /api/forum/:id/vote`: Records a user like or dislike vote (one vote per user rule).
- `GET /api/forum/:id/comments`: Fetches comments for a specific post.
- `POST /api/forum/:id/comments`: Adds a new comment to a forum post.
- `DELETE /api/forum/comments/:commentId`: Deletes a comment (allowed for comment author, post author trainer, or admin).

### 🛡️ Admin Dashboard & Moderation
- `GET /api/admin/stats`: Computes comprehensive platform metrics, monthly growth trajectories, and category ratios.
- `GET /api/admin/classes`: Admin view of all classes across all statuses (`Pending`, `Approved`, `Rejected`).
- `PATCH /api/admin/classes/:id/status`: Admin endpoint to approve or reject a pending class.
- `GET /api/admin/users`: Admin view of all registered platform users.
- `PATCH /api/admin/users/:id/status`: Admin endpoint to toggle account status (`active` / `blocked`).
- `PATCH /api/admin/users/:id/role`: Admin endpoint to promote users to Super Admin.
- `GET /api/admin/transactions`: Admin view of all payment transaction logs.

---

## 🚀 Local Setup & Deployment Guide

### 1. Clone Repository
```bash
git clone https://github.com/kawser0x/fitness-for-life-server.git
cd fitness-for-life-server
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment Variables
Create a `.env` file in the server root directory:
```env
PORT=5000
MONGODB_URI=mongodb+srv://<username>:<password>@cluster.mongodb.net/fitnessforlife?retryWrites=true&w=majority
ACCESS_TOKEN_SECRET=fitness_for_life_jwt_secret_key_2026
STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key
```

### 4. Run Development Server
```bash
npm run dev
```
The server will start locally on `http://localhost:5000`.

### 5. Deploy to Vercel
Ensure `vercel.json` is present in the root folder, then deploy via Vercel CLI or GitHub Integration:
```bash
vercel --prod
```

---

## 📄 License
This project is licensed under the **ISC License**.
