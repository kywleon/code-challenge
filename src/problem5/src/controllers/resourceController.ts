import { Request, Response } from "express";
import { Resource } from "../models/resource.ts";

// Create resource
export const createResource = async (req: Request, res: Response) => {
  const { name, description } = req.body;
  try {
    const resource = Resource.create({ name, description });
    await resource.save();
    res.status(201).json(resource);
  } catch (err) {
    res.status(500).json({ error: "Create failed", details: err });
  }
};

// List resources with basic filters
export const listResources = async (req: Request, res: Response) => {
  const { name } = req.query;
  try {
    const resources = await Resource.find({
      where: name ? { name: String(name) } : {},
    });
    res.json(resources);
  } catch (err) {
    res.status(500).json({ error: "List failed", details: err });
  }
};

// Get details of a resource
export const getResource = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const resource = await Resource.findOneBy({ id: Number(id) });
    if (!resource) return res.status(404).json({ error: "Not found" });
    res.json(resource);
  } catch (err) {
    res.status(500).json({ error: "Fetch failed", details: err });
  }
};

// Update resources details
export const updateResource = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, description } = req.body;
  try {
    const resource = await Resource.findOneBy({ id: Number(id) });
    if (!resource) return res.status(404).json({ error: "Not found" });

    resource.name = name ?? resource.name;
    resource.description = description ?? resource.description;
    await resource.save();
    res.json(resource);
  } catch (err) {
    res.status(500).json({ error: "Update failed", details: err });
  }
};

// Delete resources
export const deleteResource = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const resource = await Resource.findOneBy({ id: Number(id) });
    if (!resource) return res.status(404).json({ error: "Not found" });

    await resource.remove();
    res.json({ message: "Deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: "Delete failed", details: err });
  }
};
