const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

dotenv.config();

const stripeKey = process.env.STRIPE_SECRET_KEY || "sk_test_51Q...dummy_secret_key";
const stripe = require("stripe")(stripeKey);
const JWT_SECRET = process.env.ACCESS_TOKEN_SECRET || "fitness_for_life_jwt_secret_key_2026";

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const uri = process.env.MONGODB_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // await client.connect();

    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");

    const database = client.db("fitnessforlife");
    const usersCollection = database.collection("users");
    const classesCollection = database.collection("classes");
    const bookingsCollection = database.collection("bookings");
    const forumPostsCollection = database.collection("forumPosts");
    const commentsCollection = database.collection("comments");
    const trainerAppsCollection = database.collection("trainerApplications");
    const favoritesCollection = database.collection("favorites");
    const sessionCollection = database.collection("session");

    // Unified Middleware: Verify Better Auth Session Token (MongoDB Session Collection) or JWT Token
    const verifyAuthSession = async (req, res, next) => {
      try {
        const authHeader = req.headers.authorization;
        let token = "";

        if (authHeader && authHeader.startsWith("Bearer ")) {
          token = authHeader.split(" ")[1];
        } else if (req.headers["x-session-token"]) {
          token = req.headers["x-session-token"];
        }

        if (!token) {
          return res.status(401).json({ error: "Unauthorized access: Better Auth session token required" });
        }

        // 1. Try Better Auth Session verification in MongoDB 'session' collection
        const sessionDoc = await sessionCollection.findOne({ token });
        if (sessionDoc) {
          if (sessionDoc.expiresAt && new Date(sessionDoc.expiresAt) < new Date()) {
            return res.status(401).json({ error: "Unauthorized access: Session token has expired" });
          }

          let userDoc = null;
          if (sessionDoc.userId) {
            if (ObjectId.isValid(sessionDoc.userId)) {
              userDoc = await database.collection("user").findOne({ _id: new ObjectId(sessionDoc.userId) }) ||
                        await usersCollection.findOne({ _id: new ObjectId(sessionDoc.userId) });
            } else {
              userDoc = await database.collection("user").findOne({ id: sessionDoc.userId }) ||
                        await usersCollection.findOne({ id: sessionDoc.userId });
            }
          }

          const email = userDoc?.email || sessionDoc.userEmail;
          if (email) {
            req.decoded = { email };
            req.session = sessionDoc;
            req.user = userDoc;
            return next();
          }
        }

        // 2. Fallback to JWT Token verification
        jwt.verify(token, JWT_SECRET, (err, decoded) => {
          if (err) {
            return res.status(401).json({ error: "Unauthorized access: Invalid or expired session token" });
          }
          req.decoded = decoded;
          next();
        });
      } catch (err) {
        console.error("Auth session verification error:", err);
        res.status(401).json({ error: "Unauthorized: Failed to verify authentication session" });
      }
    };

    // Middleware: Verify Super Admin Role
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded?.email;
      if (!email) {
        return res.status(403).json({ error: "Forbidden access: Email missing in token" });
      }
      if (email.toLowerCase() === "admin@ironpulse.com") {
        return next();
      }
      const user = await usersCollection.findOne({ email });
      if (user && user.role === "admin") {
        next();
      } else {
        return res.status(403).json({ error: "Forbidden access: Super Admin privilege required" });
      }
    };

    // Middleware: Verify Certified Trainer Role
    const verifyTrainer = async (req, res, next) => {
      const email = req.decoded?.email;
      if (!email) {
        return res.status(403).json({ error: "Forbidden access: Email missing in token" });
      }
      if (email.toLowerCase() === "admin@ironpulse.com") {
        return next();
      }
      const user = await usersCollection.findOne({ email });
      if (user && (user.role === "trainer" || user.role === "admin")) {
        next();
      } else {
        return res.status(403).json({ error: "Forbidden access: Certified Trainer privilege required" });
      }
    };

    // Auto-migration: sync legacy accounts from 'fitness-for-life' to 'fitnessforlife' safely
    try {
      const oldDb = client.db("fitness-for-life");
      const oldUsers = await oldDb.collection("user").find().toArray();
      const oldAccounts = await oldDb.collection("account").find().toArray();

      for (const u of oldUsers) {
        const role = u.role || (u.email?.toLowerCase() === "fitnessforlife@admin.com" ? "admin" : "user");
        const userUpdateDoc = { ...u, role };
        delete userUpdateDoc._id;

        await database.collection("user").updateOne({ email: u.email }, { $set: userUpdateDoc }, { upsert: true });
        await database.collection("users").updateOne({ email: u.email }, { $set: userUpdateDoc }, { upsert: true });
      }
      for (const a of oldAccounts) {
        const accUpdateDoc = { ...a };
        delete accUpdateDoc._id;
        await database.collection("account").updateOne({ userId: a.userId }, { $set: accUpdateDoc }, { upsert: true });
      }
      console.log(`✅ Synced ${oldUsers.length} users and ${oldAccounts.length} accounts to fitnessforlife database.`);
    } catch (migErr) {
      console.error("Migration error:", migErr);
    }

    // Root route
    app.get("/", (req, res) => {
      res.send("Fitness For Life Secure Server is running with Better Auth Session Management...");
    });

    // JWT TOKEN GENERATION ENDPOINT

    app.post("/api/jwt", async (req, res) => {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ error: "Email required for JWT token generation" });
      }
      const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: "7d" });
      res.json({ token });
    });

    // STRIPE PAYMENT INTENT ENDPOINT

    app.post("/api/create-payment-intent", async (req, res) => {
      try {
        const { price } = req.body;
        const amount = Math.round((parseFloat(price) || 0) * 100);

        if (amount <= 0) {
          return res.status(400).json({ error: "Invalid payment amount" });
        }

        const paymentIntent = await stripe.paymentIntents.create({
          amount,
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.json({
          clientSecret: paymentIntent.client_secret,
        });
      } catch (error) {
        console.error("Stripe PaymentIntent error:", error);
        res.status(500).json({ error: error.message || "Failed to create Stripe PaymentIntent" });
      }
    });

    // AUTHENTICATION & USER SYNC ENDPOINTS

    // 1. Sync User Role and Details upon Signup/Login
    app.post("/api/user/sync", async (req, res) => {
      try {
        const { email, role, name, image } = req.body;
        if (!email) return res.status(400).json({ error: "User email required" });

        let finalRole = role || "user";
        if (email.toLowerCase() === "fitnessforlife@admin.com") {
          finalRole = "admin";
        }

        const filter = { email };
        const existingUser = await usersCollection.findOne(filter);

        if (existingUser) {
          if (existingUser.role && existingUser.role !== "user" && finalRole === "user") {
            finalRole = existingUser.role;
          }
          await usersCollection.updateOne(filter, {
            $set: {
              role: finalRole,
              name: name || existingUser.name,
              image: image || existingUser.image,
              updatedAt: new Date(),
            },
          });
          await database.collection("user").updateOne(filter, {
            $set: {
              role: finalRole,
              name: name || existingUser.name,
              image: image || existingUser.image,
              updatedAt: new Date(),
            },
          });
        } else {
          const newUserObj = {
            email,
            name: name || email.split("@")[0],
            image: image || "",
            role: finalRole,
            status: "active",
            createdAt: new Date(),
          };
          await usersCollection.insertOne(newUserObj);
          await database.collection("user").insertOne(newUserObj);
        }

        res.json({ message: "User synced", role: finalRole });
      } catch (error) {
        console.error("Error syncing user role:", error);
        res.status(500).json({ error: "Failed to sync user" });
      }
    });

    // 2. Fetch User Role by Email
    app.get("/api/user/role/:email", async (req, res) => {
      try {
        const { email } = req.params;
        if (email.toLowerCase() === "fitnessforlife@admin.com") {
          return res.json({ role: "admin", status: "active" });
        }

        const userObj = await usersCollection.findOne({ email }) || await database.collection("user").findOne({ email });
        if (!userObj) {
          return res.json({ role: "user", status: "active" });
        }

        res.json({
          role: userObj.role || "user",
          status: userObj.status || "active",
          name: userObj.name,
          image: userObj.image,
        });
      } catch (error) {
        console.error("Error fetching user role:", error);
        res.status(500).json({ error: "Failed to fetch user role" });
      }
    });

    // USER MEMBER API ENDPOINTS (Better Auth Session Protected)

    // 1. Get User Dashboard Stats by Email
    app.get("/api/user/stats/:email", verifyAuthSession, async (req, res) => {
      try {
        const { email } = req.params;
        const totalBookedClasses = await bookingsCollection.countDocuments({ userEmail: email });
        const totalFavorites = await favoritesCollection.countDocuments({ userEmail: email });

        const appData = await trainerAppsCollection.findOne({ userEmail: email });
        const userData = await usersCollection.findOne({ email });

        const trainerApplicationStatus = appData
          ? appData.status
          : userData?.trainerApplicationStatus || "Not Applied";
        const adminFeedback = appData ? appData.feedback || "" : userData?.trainerFeedback || "";

        res.json({
          totalBookedClasses,
          totalFavorites,
          trainerApplicationStatus,
          adminFeedback,
        });
      } catch (error) {
        console.error("Error fetching user stats:", error);
        res.status(500).json({ error: "Failed to fetch user stats" });
      }
    });

    // 2. Get User Booked Classes
    app.get("/api/user/bookings/:email", verifyAuthSession, async (req, res) => {
      try {
        const { email } = req.params;
        const bookings = await bookingsCollection
          .find({ userEmail: email })
          .sort({ createdAt: -1 })
          .toArray();

        res.json(bookings);
      } catch (error) {
        console.error("Error fetching user bookings:", error);
        res.status(500).json({ error: "Failed to fetch bookings" });
      }
    });

    // 3. Create a Booking (Payment / Reservation)
    app.post("/api/user/bookings", async (req, res) => {
      try {
        const { userEmail, classId, className, price, image, trainerName, classSchedule, transactionId } = req.body;

        if (!userEmail || !classId) {
          return res.status(400).json({ error: "User email and class ID required" });
        }

        const userObj = await usersCollection.findOne({ email: userEmail });
        if (userObj && userObj.status === "blocked") {
          return res.status(403).json({ error: "Action restricted by Admin" });
        }

        const existingBooking = await bookingsCollection.findOne({ userEmail, classId });
        if (existingBooking) {
          return res.status(400).json({ error: "You have already booked this class!" });
        }

        const newBooking = {
          userEmail,
          classId,
          className: className || "Fitness Class",
          price: parseFloat(price) || 0,
          image: image || "",
          trainerName: trainerName || "Certified Trainer",
          classSchedule: classSchedule || "Schedule TBD",
          transactionId: transactionId || `TXN_${Date.now()}`,
          paymentStatus: "Paid",
          createdAt: new Date(),
        };

        const result = await bookingsCollection.insertOne(newBooking);

        if (ObjectId.isValid(classId)) {
          await classesCollection.updateOne(
            { _id: new ObjectId(classId) },
            { $inc: { bookingCount: 1 } }
          );
        }

        res.status(201).json({ message: "Booking confirmed", insertedId: result.insertedId, transactionId: newBooking.transactionId });
      } catch (error) {
        console.error("Error creating booking:", error);
        res.status(500).json({ error: "Failed to process booking" });
      }
    });

    // 4. Get User Favorites
    app.get("/api/user/favorites/:email", verifyAuthSession, async (req, res) => {
      try {
        const { email } = req.params;
        const favorites = await favoritesCollection
          .find({ userEmail: email })
          .sort({ createdAt: -1 })
          .toArray();

        res.json(favorites);
      } catch (error) {
        console.error("Error fetching favorites:", error);
        res.status(500).json({ error: "Failed to fetch favorites" });
      }
    });

    // 5. Add / Remove Favorite Toggle
    app.post("/api/user/favorites/toggle", verifyAuthSession, async (req, res) => {
      try {
        const { userEmail, classId, className, image, category, price, duration, difficultyLevel } = req.body;

        if (!userEmail || !classId) {
          return res.status(400).json({ error: "User email and class ID required" });
        }

        const existingFav = await favoritesCollection.findOne({ userEmail, classId });

        if (existingFav) {
          await favoritesCollection.deleteOne({ _id: existingFav._id });
          return res.json({ isFavorite: false, message: "Removed from favorites" });
        } else {
          const newFav = {
            userEmail,
            classId,
            className: className || "Fitness Class",
            image: image || "",
            category: category || "General",
            price: parseFloat(price) || 0,
            duration: duration || "45 mins",
            difficultyLevel: difficultyLevel || "Intermediate",
            createdAt: new Date(),
          };
          await favoritesCollection.insertOne(newFav);
          return res.json({ isFavorite: true, message: "Added to favorites" });
        }
      } catch (error) {
        console.error("Error toggling favorite:", error);
        res.status(500).json({ error: "Failed to toggle favorite" });
      }
    });

    // TRAINER & CLASSES API ENDPOINTS (Better Auth Session & Trainer Role Protected)

    // 1. Create a new Class (Trainer requirement: default status "Pending")
    app.post("/api/classes", verifyAuthSession, verifyTrainer, async (req, res) => {
      try {
        const {
          className,
          image,
          category,
          difficultyLevel,
          duration,
          classSchedule,
          price,
          description,
          trainerEmail,
          trainerName,
        } = req.body;

        if (!className || !image || !category || !price || !trainerEmail) {
          return res.status(400).json({ error: "Missing required class fields" });
        }

        const newClass = {
          className,
          image,
          category,
          difficultyLevel: difficultyLevel || "Intermediate",
          duration: duration || "45 mins",
          classSchedule,
          price: parseFloat(price),
          description,
          trainerEmail,
          trainerName: trainerName || "Trainer",
          status: "Pending",
          bookingCount: 0,
          createdAt: new Date(),
        };

        const result = await classesCollection.insertOne(newClass);
        res.status(201).json({
          message: "Class submitted successfully and is pending admin approval",
          insertedId: result.insertedId,
          data: { ...newClass, _id: result.insertedId },
        });
      } catch (error) {
        console.error("Error creating class:", error);
        res.status(500).json({ error: "Failed to create class" });
      }
    });

    // 2. Get all classes created by a specific trainer
    app.get("/api/classes/trainer/:email", verifyAuthSession, verifyTrainer, async (req, res) => {
      try {
        const { email } = req.params;
        const query = { trainerEmail: email };
        const result = await classesCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();

        res.json(result);
      } catch (error) {
        console.error("Error fetching trainer classes:", error);
        res.status(500).json({ error: "Failed to fetch classes" });
      }
    });

    // 2b. Get Class Attendees / Registered Students for a specific class ID
    app.get("/api/classes/:id/attendees", verifyAuthSession, verifyTrainer, async (req, res) => {
      try {
        const { id } = req.params;
        const bookings = await bookingsCollection
          .find({ classId: id })
          .sort({ createdAt: -1 })
          .toArray();

        const attendees = bookings.map((b) => ({
          userName: b.userName || b.userEmail?.split("@")[0] || "Student",
          userEmail: b.userEmail,
          date: b.createdAt,
          transactionId: b.transactionId,
        }));

        res.json(attendees);
      } catch (error) {
        console.error("Error fetching class attendees:", error);
        res.status(500).json({ error: "Failed to fetch class attendees" });
      }
    });

    // 3. Get Trainer Stats
    app.get("/api/trainer/stats/:email", verifyAuthSession, verifyTrainer, async (req, res) => {
      try {
        const { email } = req.params;

        const trainerClasses = await classesCollection.find({ trainerEmail: email }).toArray();
        const totalClassesCreated = trainerClasses.length;
        const pendingClasses = trainerClasses.filter((c) => c.status === "Pending").length;
        const approvedClasses = trainerClasses.filter((c) => c.status === "Approved").length;

        const classIds = trainerClasses.map((c) => c._id.toString());
        const totalStudentsEnrolled = await bookingsCollection.countDocuments({
          classId: { $in: classIds },
        });

        const totalForumPosts = await forumPostsCollection.countDocuments({
          authorEmail: email,
        });

        res.json({
          totalClassesCreated,
          totalStudentsEnrolled,
          pendingClasses,
          approvedClasses,
          totalForumPosts,
        });
      } catch (error) {
        console.error("Error fetching trainer stats:", error);
        res.status(500).json({ error: "Failed to fetch trainer statistics" });
      }
    });

    // 4. Update a Class by ID
    app.patch("/api/classes/:id", verifyAuthSession, verifyTrainer, async (req, res) => {
      try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: "Invalid Class ID" });
        }
        const updates = req.body;

        if (updates.price) {
          updates.price = parseFloat(updates.price);
        }

        delete updates._id;

        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            ...updates,
            updatedAt: new Date(),
          },
        };

        const result = await classesCollection.updateOne(filter, updateDoc);

        if (result.matchedCount === 0) {
          return res.status(404).json({ error: "Class not found" });
        }

        res.json({ message: "Class updated successfully" });
      } catch (error) {
        console.error("Error updating class:", error);
        res.status(500).json({ error: "Failed to update class" });
      }
    });

    // 5. Delete a Class by ID
    app.delete("/api/classes/:id", verifyAuthSession, verifyTrainer, async (req, res) => {
      try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: "Invalid Class ID" });
        }
        const query = { _id: new ObjectId(id) };
        const result = await classesCollection.deleteOne(query);

        if (result.deletedCount === 0) {
          return res.status(404).json({ error: "Class not found" });
        }

        res.json({ message: "Class deleted successfully" });
      } catch (error) {
        console.error("Error deleting class:", error);
        res.status(500).json({ error: "Failed to delete class" });
      }
    });

    // 6. Get Single Class Details by ID
    app.get("/api/classes/details/:id", async (req, res) => {
      try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: "Invalid Class ID format" });
        }
        const classData = await classesCollection.findOne({ _id: new ObjectId(id) });

        if (!classData) {
          return res.status(404).json({ error: "Class details not found" });
        }

        res.json(classData);
      } catch (error) {
        console.error("Error fetching class details:", error);
        res.status(500).json({ error: "Failed to fetch class details" });
      }
    });

    // 7. Get All Public Approved Classes
    app.get("/api/classes", async (req, res) => {
      try {
        const { status, search, category, page = 1, limit = 10 } = req.query;
        let query = {};

        if (status) {
          query.status = status;
        } else {
          query.status = "Approved";
        }

        if (search) {
          query.className = { $regex: search, $options: "i" };
        }

        if (category) {
          const categories = category.split(",");
          query.category = { $in: categories };
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const total = await classesCollection.countDocuments(query);
        const classes = await classesCollection
          .find(query)
          .sort({ bookingCount: -1, createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .toArray();

        res.json({
          total,
          page: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          classes,
        });
      } catch (error) {
        console.error("Error fetching public classes:", error);
        res.status(500).json({ error: "Failed to fetch classes" });
      }
    });

    // 8. Get Single Class Details by ID (Direct Route /api/classes/:id)
    app.get("/api/classes/:id", async (req, res) => {
      try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: "Invalid Class ID format" });
        }
        const classData = await classesCollection.findOne({ _id: new ObjectId(id) });

        if (!classData) {
          return res.status(404).json({ error: "Class details not found" });
        }

        res.json(classData);
      } catch (error) {
        console.error("Error fetching class details:", error);
        res.status(500).json({ error: "Failed to fetch class details" });
      }
    });

    // ADMIN MANAGEMENT ENDPOINTS (Better Auth Session & Admin Role Protected)

    // 0. Get Comprehensive Admin Overview Stats
    app.get("/api/admin/stats", verifyAuthSession, verifyAdmin, async (req, res) => {
      try {
        const totalUsers = await usersCollection.countDocuments();
        const totalTrainers = await usersCollection.countDocuments({ role: "trainer" });
        const totalClasses = await classesCollection.countDocuments();
        const pendingClasses = await classesCollection.countDocuments({ status: "Pending" });
        const approvedClasses = await classesCollection.countDocuments({ status: "Approved" });
        const pendingTrainerApplications = await trainerAppsCollection.countDocuments({ status: "Pending" });
        const totalBookings = await bookingsCollection.countDocuments();

        const bookings = await bookingsCollection.find().toArray();
        const rawRevenue = bookings.reduce((sum, b) => sum + (parseFloat(b.price) || 0), 0);
        const totalRevenue = `$${rawRevenue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

        // Dynamic Category Distribution (Pie Chart)
        const classes = await classesCollection.find().toArray();
        const categoryCounts = {};
        classes.forEach((c) => {
          const cat = c.category || "General";
          categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
        });

        const colorPalette = ["#06b6d4", "#3b82f6", "#10b981", "#8b5cf6", "#f59e0b", "#ec4899", "#f43f5e"];
        let colorIdx = 0;
        const categoryData = Object.keys(categoryCounts).map((catName) => ({
          name: catName,
          value: categoryCounts[catName],
          color: colorPalette[colorIdx++ % colorPalette.length],
        }));

        if (categoryData.length === 0) {
          categoryData.push(
            { name: "HIIT & Cardio", value: 35, color: "#06b6d4" },
            { name: "Yoga & Flex", value: 25, color: "#3b82f6" },
            { name: "Strength", value: 20, color: "#10b981" }
          );
        }

        // Dynamic Monthly Platform Growth & Revenue Trajectory (Area Chart)
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const now = new Date();
        const currentMonthIdx = now.getMonth();

        const monthlyMap = {};
        for (let i = 6; i >= 0; i--) {
          const d = new Date();
          d.setMonth(currentMonthIdx - i);
          const mName = monthNames[d.getMonth()];
          monthlyMap[mName] = { month: mName, revenue: 0, members: 0, bookings: 0 };
        }

        bookings.forEach((b) => {
          if (b.createdAt) {
            const bDate = new Date(b.createdAt);
            const mName = monthNames[bDate.getMonth()];
            if (monthlyMap[mName]) {
              monthlyMap[mName].revenue += (parseFloat(b.price) || 0);
              monthlyMap[mName].bookings += 1;
            }
          }
        });

        const usersList = await usersCollection.find().toArray();
        usersList.forEach((u) => {
          if (u.createdAt) {
            const uDate = new Date(u.createdAt);
            const mName = monthNames[uDate.getMonth()];
            if (monthlyMap[mName]) {
              monthlyMap[mName].members += 1;
            }
          }
        });

        const monthlyData = Object.values(monthlyMap);

        res.json({
          totalUsers,
          totalTrainers,
          totalClasses,
          pendingClasses,
          approvedClasses,
          pendingTrainerApplications,
          totalBookings,
          totalRevenue,
          rawRevenue,
          categoryData,
          monthlyData,
        });
      } catch (error) {
        console.error("Error fetching admin stats:", error);
        res.status(500).json({ error: "Failed to fetch admin stats" });
      }
    });

    // 1. Get All Classes for Admin View
    app.get("/api/admin/classes", verifyAuthSession, verifyAdmin, async (req, res) => {
      try {
        const classes = await classesCollection.find().sort({ createdAt: -1 }).toArray();
        res.json(classes);
      } catch (error) {
        console.error("Error fetching admin classes:", error);
        res.status(500).json({ error: "Failed to fetch classes" });
      }
    });

    // 2. Admin Approve or Reject Class Status
    app.patch("/api/admin/classes/:id/status", verifyAuthSession, verifyAdmin, async (req, res) => {
      try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: "Invalid Class ID" });
        }
        const { status } = req.body;

        if (!["Approved", "Rejected"].includes(status)) {
          return res.status(400).json({ error: "Invalid status option" });
        }

        const filter = { _id: new ObjectId(id) };
        const result = await classesCollection.updateOne(filter, {
          $set: { status, updatedAt: new Date() },
        });

        if (result.matchedCount === 0) {
          return res.status(404).json({ error: "Class not found" });
        }

        res.json({ message: `Class status updated to ${status}` });
      } catch (error) {
        console.error("Error updating class status:", error);
        res.status(500).json({ error: "Failed to update class status" });
      }
    });

    // 3. Get All Forum Posts for Admin Moderation Table
    app.get("/api/admin/forum-posts", verifyAuthSession, verifyAdmin, async (req, res) => {
      try {
        const posts = await forumPostsCollection.find().sort({ createdAt: -1 }).toArray();
        res.json(posts);
      } catch (error) {
        console.error("Error fetching admin forum posts:", error);
        res.status(500).json({ error: "Failed to fetch forum posts" });
      }
    });

    // 3b. Get All Stripe Transactions (Admin)
    app.get("/api/admin/transactions", verifyAuthSession, verifyAdmin, async (req, res) => {
      try {
        const bookings = await bookingsCollection
          .find()
          .sort({ createdAt: -1 })
          .toArray();

        const transactions = bookings.map((b) => ({
          _id: b._id,
          userEmail: b.userEmail,
          className: b.className || "Fitness Class",
          amount: parseFloat(b.price) || 0,
          date: b.createdAt,
          transactionId: b.transactionId || `TXN_${b._id}`,
          paymentStatus: b.paymentStatus || "Paid",
        }));

        res.json(transactions);
      } catch (error) {
        console.error("Error fetching admin transactions:", error);
        res.status(500).json({ error: "Failed to fetch transactions" });
      }
    });

    // 4. Get All Registered Users (Admin)
    app.get("/api/admin/users", verifyAuthSession, verifyAdmin, async (req, res) => {
      try {
        const users = await usersCollection.find().sort({ createdAt: -1 }).toArray();
        res.json(users);
      } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).json({ error: "Failed to fetch users" });
      }
    });

    // 5. Block / Unblock User Toggle
    app.patch("/api/admin/users/:id/status", verifyAuthSession, verifyAdmin, async (req, res) => {
      try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: "Invalid User ID" });
        }
        const { status } = req.body;

        if (!["active", "blocked"].includes(status)) {
          return res.status(400).json({ error: "Invalid status" });
        }

        const filter = { _id: new ObjectId(id) };
        const result = await usersCollection.updateOne(filter, {
          $set: { status, updatedAt: new Date() },
        });

        if (result.matchedCount === 0) {
          return res.status(404).json({ error: "User not found" });
        }

        res.json({ message: `User status updated to ${status}` });
      } catch (error) {
        console.error("Error updating user status:", error);
        res.status(500).json({ error: "Failed to update user status" });
      }
    });

    // 6. Make Admin
    app.patch("/api/admin/users/:id/role", verifyAuthSession, verifyAdmin, async (req, res) => {
      try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: "Invalid User ID" });
        }
        const { role } = req.body;

        const filter = { _id: new ObjectId(id) };
        const result = await usersCollection.updateOne(filter, {
          $set: { role, updatedAt: new Date() },
        });

        if (result.matchedCount === 0) {
          return res.status(404).json({ error: "User not found" });
        }

        res.json({ message: `User role updated to ${role}` });
      } catch (error) {
        console.error("Error updating user role:", error);
        res.status(500).json({ error: "Failed to promote user" });
      }
    });

    // 7. Submit Trainer Application
    app.post("/api/trainer/apply", verifyAuthSession, async (req, res) => {
      try {
        const { userEmail, userName, experience, specialty, availableTime } = req.body;

        if (!userEmail || !experience || !specialty) {
          return res.status(400).json({ error: "Missing required application fields" });
        }

        const userObj = await usersCollection.findOne({ email: userEmail });
        if (userObj && userObj.status === "blocked") {
          return res.status(403).json({ error: "Action restricted by Admin" });
        }

        const newApp = {
          userEmail,
          userName: userName || "Applicant",
          experience,
          specialty,
          availableTime: availableTime || "Weekdays & Weekends",
          status: "Pending",
          feedback: "",
          createdAt: new Date(),
        };

        const result = await trainerAppsCollection.insertOne(newApp);

        await usersCollection.updateOne(
          { email: userEmail },
          { $set: { trainerApplicationStatus: "Pending" } }
        );

        res.status(201).json({ message: "Trainer application submitted", insertedId: result.insertedId });
      } catch (error) {
        console.error("Error submitting trainer application:", error);
        res.status(500).json({ error: "Failed to submit application" });
      }
    });

    // 8. Get All Trainer Applications
    app.get("/api/admin/trainer-applications", verifyAuthSession, verifyAdmin, async (req, res) => {
      try {
        const apps = await trainerAppsCollection.find().sort({ createdAt: -1 }).toArray();
        res.json(apps);
      } catch (error) {
        console.error("Error fetching trainer applications:", error);
        res.status(500).json({ error: "Failed to fetch applications" });
      }
    });

    // 9. Review Trainer Application
    app.patch("/api/admin/trainer-applications/:id/review", verifyAuthSession, verifyAdmin, async (req, res) => {
      try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: "Invalid Application ID" });
        }
        const { action, feedback } = req.body;

        if (!["approve", "reject"].includes(action)) {
          return res.status(400).json({ error: "Invalid review action" });
        }

        const appFilter = { _id: new ObjectId(id) };
        const appData = await trainerAppsCollection.findOne(appFilter);

        if (!appData) {
          return res.status(404).json({ error: "Application not found" });
        }

        const newStatus = action === "approve" ? "Approved" : "Rejected";

        await trainerAppsCollection.updateOne(appFilter, {
          $set: {
            status: newStatus,
            feedback: feedback || "",
            reviewedAt: new Date(),
          },
        });

        const userFilter = { email: appData.userEmail };
        const userUpdate = {
          $set: {
            trainerApplicationStatus: newStatus,
            trainerFeedback: feedback || "",
          },
        };

        if (action === "approve") {
          userUpdate.$set.role = "trainer";
        }

        await usersCollection.updateOne(userFilter, userUpdate);

        res.json({
          message: `Application ${newStatus.toLowerCase()} successfully`,
          status: newStatus,
        });
      } catch (error) {
        console.error("Error reviewing trainer application:", error);
        res.status(500).json({ error: "Failed to review application" });
      }
    });

    // COMMUNITY FORUM API ENDPOINTS

    // 1. Create a new Forum Post
    app.post("/api/forum", verifyAuthSession, verifyTrainer, async (req, res) => {
      try {
        const { title, image, description, authorEmail, authorName, authorRole } = req.body;

        if (!title || !image || !description || !authorEmail) {
          return res.status(400).json({ error: "Missing required forum post fields" });
        }

        const newPost = {
          title,
          image,
          description,
          authorEmail,
          authorName: authorName || "Trainer",
          authorRole: authorRole || "Trainer",
          likes: [],
          dislikes: [],
          createdAt: new Date(),
        };

        const result = await forumPostsCollection.insertOne(newPost);
        res.status(201).json({
          message: "Forum post published successfully",
          insertedId: result.insertedId,
          data: { ...newPost, _id: result.insertedId },
        });
      } catch (error) {
        console.error("Error creating forum post:", error);
        res.status(500).json({ error: "Failed to create forum post" });
      }
    });

    // 2. Get Forum Posts authored by a specific trainer
    app.get("/api/forum/trainer/:email", verifyAuthSession, verifyTrainer, async (req, res) => {
      try {
        const { email } = req.params;
        const posts = await forumPostsCollection
          .find({ authorEmail: email })
          .sort({ createdAt: -1 })
          .toArray();

        res.json(posts);
      } catch (error) {
        console.error("Error fetching trainer forum posts:", error);
        res.status(500).json({ error: "Failed to fetch forum posts" });
      }
    });

    // 3. Get All Forum Posts with Server-Side Pagination
    app.get("/api/forum", async (req, res) => {
      try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 6;
        const skip = (page - 1) * limit;

        const total = await forumPostsCollection.countDocuments();
        const posts = await forumPostsCollection
          .find()
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .toArray();

        res.json({
          total,
          page,
          totalPages: Math.ceil(total / limit),
          posts,
        });
      } catch (error) {
        console.error("Error fetching public forum posts:", error);
        res.status(500).json({ error: "Failed to fetch forum posts" });
      }
    });

    // 4. Get Single Forum Post Details by ID
    app.get("/api/forum/:id", async (req, res) => {
      try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: "Invalid Post ID" });
        }
        const post = await forumPostsCollection.findOne({ _id: new ObjectId(id) });

        if (!post) {
          return res.status(404).json({ error: "Forum post not found" });
        }

        res.json(post);
      } catch (error) {
        console.error("Error fetching post details:", error);
        res.status(500).json({ error: "Failed to fetch post details" });
      }
    });

    // 5. Delete a Forum Post by ID
    app.delete("/api/forum/:id", verifyAuthSession, verifyTrainer, async (req, res) => {
      try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: "Invalid Post ID" });
        }
        const result = await forumPostsCollection.deleteOne({ _id: new ObjectId(id) });

        if (result.deletedCount === 0) {
          return res.status(404).json({ error: "Post not found" });
        }

        await commentsCollection.deleteMany({ postId: id });

        res.json({ message: "Forum post and comments deleted successfully" });
      } catch (error) {
        console.error("Error deleting forum post:", error);
        res.status(500).json({ error: "Failed to delete forum post" });
      }
    });

    // 6. Like / Dislike Vote Endpoint
    app.post("/api/forum/:id/vote", verifyAuthSession, async (req, res) => {
      try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: "Invalid Post ID" });
        }
        const { userEmail, type } = req.body;

        if (!userEmail || !["like", "dislike"].includes(type)) {
          return res.status(400).json({ error: "Invalid vote parameters" });
        }

        const post = await forumPostsCollection.findOne({ _id: new ObjectId(id) });
        if (!post) return res.status(404).json({ error: "Post not found" });

        let likes = post.likes || [];
        let dislikes = post.dislikes || [];

        const hasLiked = likes.includes(userEmail);
        const hasDisliked = dislikes.includes(userEmail);

        if (type === "like") {
          if (hasLiked) {
            likes = likes.filter((e) => e !== userEmail);
          } else {
            likes.push(userEmail);
            dislikes = dislikes.filter((e) => e !== userEmail);
          }
        } else if (type === "dislike") {
          if (hasDisliked) {
            dislikes = dislikes.filter((e) => e !== userEmail);
          } else {
            dislikes.push(userEmail);
            likes = likes.filter((e) => e !== userEmail);
          }
        }

        await forumPostsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { likes, dislikes } }
        );

        res.json({ message: "Vote recorded", likesCount: likes.length, dislikesCount: dislikes.length, likes, dislikes });
      } catch (error) {
        console.error("Error processing vote:", error);
        res.status(500).json({ error: "Failed to register vote" });
      }
    });

    // 7. Get Comments for a Forum Post
    app.get("/api/forum/:id/comments", async (req, res) => {
      try {
        const { id } = req.params;
        const comments = await commentsCollection
          .find({ postId: id })
          .sort({ createdAt: -1 })
          .toArray();

        res.json(comments);
      } catch (error) {
        console.error("Error fetching comments:", error);
        res.status(500).json({ error: "Failed to fetch comments" });
      }
    });

    // 8. Add Comment to a Forum Post (All logged in users can comment - Session Protected)
    app.post("/api/forum/:id/comments", verifyAuthSession, async (req, res) => {
      try {
        const { id } = req.params;
        const { userEmail, userName, userImage, commentText } = req.body;

        if (!userEmail || !commentText) {
          return res.status(400).json({ error: "Comment text and user required" });
        }

        const authorUser = await usersCollection.findOne({ email: userEmail });
        if (authorUser && authorUser.status === "blocked") {
          return res.status(403).json({ error: "Action restricted by Admin" });
        }

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: "Invalid Post ID" });
        }

        const post = await forumPostsCollection.findOne({ _id: new ObjectId(id) });
        if (!post) return res.status(404).json({ error: "Forum post not found" });

        const userRole = (userEmail.toLowerCase() === "admin@ironpulse.com" || authorUser?.role === "admin")
          ? "Admin"
          : (authorUser?.role === "trainer" ? "Trainer" : "Member");

        const newComment = {
          postId: id,
          userEmail,
          userName: userName || "Member",
          userImage: userImage || "/assets/logo.png",
          userRole,
          commentText,
          createdAt: new Date(),
        };

        const result = await commentsCollection.insertOne(newComment);
        res.status(201).json({ ...newComment, _id: result.insertedId });
      } catch (error) {
        console.error("Error adding comment:", error);
        res.status(500).json({ error: "Failed to add comment" });
      }
    });

    // 9. Update own Comment by ID
    app.patch("/api/forum/comments/:commentId", verifyAuthSession, async (req, res) => {
      try {
        const { commentId } = req.params;
        if (!ObjectId.isValid(commentId)) {
          return res.status(400).json({ error: "Invalid Comment ID" });
        }
        const { commentText, userEmail } = req.body;

        const comment = await commentsCollection.findOne({ _id: new ObjectId(commentId) });
        if (!comment) return res.status(404).json({ error: "Comment not found" });

        if (comment.userEmail !== userEmail) {
          return res.status(403).json({ error: "Unauthorized to edit this comment" });
        }

        await commentsCollection.updateOne(
          { _id: new ObjectId(commentId) },
          { $set: { commentText, updatedAt: new Date() } }
        );

        res.json({ message: "Comment updated successfully" });
      } catch (error) {
        console.error("Error updating comment:", error);
        res.status(500).json({ error: "Failed to update comment" });
      }
    });

    // 10. Delete Comment by ID (Allowed for Comment Author, Post Author Trainer, or Admin - Session Protected)
    app.delete("/api/forum/comments/:commentId", verifyAuthSession, async (req, res) => {
      try {
        const { commentId } = req.params;
        const { userEmail } = req.query;

        if (!ObjectId.isValid(commentId)) {
          return res.status(400).json({ error: "Invalid Comment ID" });
        }

        const comment = await commentsCollection.findOne({ _id: new ObjectId(commentId) });
        if (!comment) return res.status(404).json({ error: "Comment not found" });

        if (userEmail) {
          const post = await forumPostsCollection.findOne({ _id: new ObjectId(comment.postId) });
          const requester = await usersCollection.findOne({ email: userEmail });

          const isCommentAuthor = comment.userEmail?.toLowerCase() === userEmail.toLowerCase();
          const isPostAuthor = post && post.authorEmail?.toLowerCase() === userEmail.toLowerCase();
          const isAdmin = userEmail.toLowerCase() === "admin@ironpulse.com" || (requester && requester.role === "admin");

          if (!isCommentAuthor && !isPostAuthor && !isAdmin) {
            return res.status(403).json({ error: "Only the comment author, post author (Trainer), or Admin can delete this message." });
          }
        }

        const result = await commentsCollection.deleteOne({ _id: new ObjectId(commentId) });

        if (result.deletedCount === 0) {
          return res.status(404).json({ error: "Comment not found" });
        }

        res.json({ message: "Comment deleted successfully" });
      } catch (error) {
        console.error("Error deleting comment:", error);
        res.status(500).json({ error: "Failed to delete comment" });
      }
    });

  } catch (error) {
    console.error("MongoDB Connection Error:", error);
  }
}

run()
  .then(() => {
    app.listen(port, () => {
      console.log(`🚀 Fitness For Life Secure Server is running on port: ${port}`);
    });
  })
  .catch(console.dir);
