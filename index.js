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

    // Root route
    app.get("/", (req, res) => {
      res.send("Fitness For Life Server is running...");
    });

    // TRAINER & CLASSES API ENDPOINTS

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
          status: "Pending", // Mandatory requirement: default status "Pending"
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

    // 3. Get Trainer Stats (Total Classes Created & Total Enrolled Students)
    app.get("/api/trainer/stats/:email", async (req, res) => {
      try {
        const { email } = req.params;

        // Fetch classes created by trainer
        const trainerClasses = await classesCollection.find({ trainerEmail: email }).toArray();
        const totalClassesCreated = trainerClasses.length;
        const pendingClasses = trainerClasses.filter((c) => c.status === "Pending").length;
        const approvedClasses = trainerClasses.filter((c) => c.status === "Approved").length;

        // Fetch total bookings for trainer's classes
        const classIds = trainerClasses.map((c) => c._id.toString());
        const totalStudentsEnrolled = await bookingsCollection.countDocuments({
          classId: { $in: classIds },
        });

        // Forum posts count by trainer
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

    // 4. Update a Class by ID (Trainer Action)
    app.patch("/api/classes/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const updates = req.body;

        if (updates.price) {
          updates.price = parseFloat(updates.price);
        }

        delete updates._id; // Remove _id if passed

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

    // 5. Delete a Class by ID (Trainer Action)
    app.delete("/api/classes/:id", async (req, res) => {
      try {
        const { id } = req.params;
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

    // 6. View Attendees / Students for a specific class (Trainer Action)
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

    // 7. Get All Public Approved Classes (with Search & Category Filter)
    app.get("/api/classes", async (req, res) => {
      try {
        const { status, search, category, page = 1, limit = 10 } = req.query;
        let query = {};

        // Requirement: Only display classes that have an "Approved" status unless requested by Admin
        if (status) {
          query.status = status;
        } else {
          query.status = "Approved";
        }

        // Search functionality ($regex)
        if (search) {
          query.className = { $regex: search, $options: "i" };
        }

        // Category filter functionality ($in)
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

    // 8. Get Single Class Details by ID
    app.get("/api/classes/details/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const classData = await classesCollection.findOne({ _id: new ObjectId(id) });

        if (!classData) {
          return res.status(404).json({ error: "Class not found" });
        }

        res.json(classData);
      } catch (error) {
        console.error("Error fetching class details:", error);
        res.status(500).json({ error: "Failed to fetch class details" });
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
