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

    // Root route
    app.get("/", (req, res) => {
      res.send("Fitness For Life Server is running...");
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

    // 4. Update a Class by ID (Trainer Action)
    app.patch("/api/classes/:id", async (req, res) => {
      try {
        const { id } = req.params;
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

    
    // COMMUNITY FORUM API ENDPOINTS

    // 1. Create a new Forum Post (Trainers & Admins)
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

    // 2. Get Forum Posts authored by a specific trainer/email
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
        const result = await forumPostsCollection.deleteOne({ _id: new ObjectId(id) });

        if (result.deletedCount === 0) {
          return res.status(404).json({ error: "Post not found" });
        }

        // Also delete associated comments
        await commentsCollection.deleteMany({ postId: id });

        res.json({ message: "Forum post and comments deleted successfully" });
      } catch (error) {
        console.error("Error deleting forum post:", error);
        res.status(500).json({ error: "Failed to delete forum post" });
      }
    });

    // 6. Like / Dislike Vote Endpoint (One vote per user rule)
    app.post("/api/forum/:id/vote", async (req, res) => {
      try {
        const { id } = req.params;
        const { userEmail, type } = req.body; // type: "like" | "dislike"

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
