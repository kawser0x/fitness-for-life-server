const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

dotenv.config();

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
    await client.connect();

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

    // Root route
    app.get("/", (req, res) => {
      res.send("Fitness For Life Server is running...");
    });

    // ==========================================
    // AUTHENTICATION & USER SYNC ENDPOINTS
    // ==========================================

    // 1. Sync User Role and Details upon Signup/Login
    app.post("/api/user/sync", async (req, res) => {
      try {
        const { email, role, name, image } = req.body;
        if (!email) return res.status(400).json({ error: "User email required" });

        // Hardcoded admin email override per specs
        let finalRole = role || "user";
        if (email.toLowerCase() === "admin@ironpulse.com") {
          finalRole = "admin";
        }

        const filter = { email };
        const existingUser = await usersCollection.findOne(filter);

        if (existingUser) {
          // If existing user already has a specific role (like admin or approved trainer), keep it unless explicitly changing to trainer
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
        } else {
          await usersCollection.insertOne({
            email,
            name: name || email.split("@")[0],
            image: image || "",
            role: finalRole,
            status: "active",
            createdAt: new Date(),
          });
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
        if (email.toLowerCase() === "admin@ironpulse.com") {
          return res.json({ role: "admin", status: "active" });
        }

        const userObj = await usersCollection.findOne({ email });
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

    // ==========================================
    // USER MEMBER API ENDPOINTS
    // ==========================================

    // 1. Get User Dashboard Stats by Email
    app.get("/api/user/stats/:email", async (req, res) => {
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
    app.get("/api/user/bookings/:email", async (req, res) => {
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
        const { userEmail, classId, className, price, image, trainerName, classSchedule } = req.body;

        if (!userEmail || !classId) {
          return res.status(400).json({ error: "User email and class ID required" });
        }

        // Soft Block check
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
          paymentStatus: "Paid",
          createdAt: new Date(),
        };

        const result = await bookingsCollection.insertOne(newBooking);

        // Increment booking count on class document
        if (ObjectId.isValid(classId)) {
          await classesCollection.updateOne(
            { _id: new ObjectId(classId) },
            { $inc: { bookingCount: 1 } }
          );
        }

        res.status(201).json({ message: "Booking confirmed", insertedId: result.insertedId });
      } catch (error) {
        console.error("Error creating booking:", error);
        res.status(500).json({ error: "Failed to process booking" });
      }
    });

    // 4. Get User Favorites
    app.get("/api/user/favorites/:email", async (req, res) => {
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
    app.post("/api/user/favorites/toggle", async (req, res) => {
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

    // ==========================================
    // TRAINER & CLASSES API ENDPOINTS
    // ==========================================

    // 1. Create a new Class (Trainer requirement: default status "Pending")
    app.post("/api/classes", async (req, res) => {
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
    app.get("/api/classes/trainer/:email", async (req, res) => {
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

    // 3. Get Trainer Stats
    app.get("/api/trainer/stats/:email", async (req, res) => {
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
    app.patch("/api/classes/:id", async (req, res) => {
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
    app.delete("/api/classes/:id", async (req, res) => {
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

    // 6. View Attendees / Students for a specific class
    app.get("/api/classes/:id/attendees", async (req, res) => {
      try {
        const { id } = req.params;
        const attendees = await bookingsCollection
          .find({ classId: id })
          .sort({ date: -1 })
          .toArray();

        res.json(attendees);
      } catch (error) {
        console.error("Error fetching class attendees:", error);
        res.status(500).json({ error: "Failed to fetch attendees" });
      }
    });

    // 7. Get Single Class Details by ID
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

    // 8. Get All Public Approved Classes
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

    // 9. Get Single Class Details by ID (Direct Route /api/classes/:id)
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

    // ==========================================
    // ADMIN MANAGEMENT ENDPOINTS (CLASSES & FORUM)
    // ==========================================

    // 1. Get All Classes for Admin View
    app.get("/api/admin/classes", async (req, res) => {
      try {
        const classes = await classesCollection.find().sort({ createdAt: -1 }).toArray();
        res.json(classes);
      } catch (error) {
        console.error("Error fetching admin classes:", error);
        res.status(500).json({ error: "Failed to fetch classes" });
      }
    });

    // 2. Admin Approve or Reject Class Status
    app.patch("/api/admin/classes/:id/status", async (req, res) => {
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
    app.get("/api/admin/forum-posts", async (req, res) => {
      try {
        const posts = await forumPostsCollection.find().sort({ createdAt: -1 }).toArray();
        res.json(posts);
      } catch (error) {
        console.error("Error fetching admin forum posts:", error);
        res.status(500).json({ error: "Failed to fetch forum posts" });
      }
    });

    // 4. Get All Registered Users (Admin)
    app.get("/api/admin/users", async (req, res) => {
      try {
        const users = await usersCollection.find().sort({ createdAt: -1 }).toArray();
        res.json(users);
      } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).json({ error: "Failed to fetch users" });
      }
    });

    // 5. Block / Unblock User Toggle
    app.patch("/api/admin/users/:id/status", async (req, res) => {
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
    app.patch("/api/admin/users/:id/role", async (req, res) => {
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
    app.post("/api/trainer/apply", async (req, res) => {
      try {
        const { userEmail, userName, experience, specialty, availableTime } = req.body;

        if (!userEmail || !experience || !specialty) {
          return res.status(400).json({ error: "Missing required application fields" });
        }

        // Soft block check for trainer application
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
    app.get("/api/admin/trainer-applications", async (req, res) => {
      try {
        const apps = await trainerAppsCollection.find().sort({ createdAt: -1 }).toArray();
        res.json(apps);
      } catch (error) {
        console.error("Error fetching trainer applications:", error);
        res.status(500).json({ error: "Failed to fetch applications" });
      }
    });

    // 9. Review Trainer Application
    app.patch("/api/admin/trainer-applications/:id/review", async (req, res) => {
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
    app.post("/api/forum", async (req, res) => {
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
    app.get("/api/forum/trainer/:email", async (req, res) => {
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
    app.delete("/api/forum/:id", async (req, res) => {
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
    app.post("/api/forum/:id/vote", async (req, res) => {
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

    // 8. Add Comment to a Forum Post
    app.post("/api/forum/:id/comments", async (req, res) => {
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

        const newComment = {
          postId: id,
          userEmail,
          userName: userName || "Member",
          userImage: userImage || "/assets/logo.png",
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
    app.patch("/api/forum/comments/:commentId", async (req, res) => {
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

    // 10. Delete own Comment by ID
    app.delete("/api/forum/comments/:commentId", async (req, res) => {
      try {
        const { commentId } = req.params;
        if (!ObjectId.isValid(commentId)) {
          return res.status(400).json({ error: "Invalid Comment ID" });
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
      console.log(`🚀 Fitness For Life Server is running on port: ${port}`);
    });
  })
  .catch(console.dir);
