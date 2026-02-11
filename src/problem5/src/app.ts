import "reflect-metadata";
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { DataSource } from "typeorm";
import resourceRoutes from "./routes/resourceRoutes.ts";
import { Resource } from "./models/resource.ts";
import dotenv from "dotenv";

dotenv.config();

export const AppDataSource = new DataSource({
  type: "sqlite",
  database: "db.sqlite",
  synchronize: true,
  entities: [Resource],
});

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use("/resources", resourceRoutes);

AppDataSource.initialize()
  .then(() => console.log("Database connected"))
  .catch((err) => console.error("DB init error:", err));

export default app;
