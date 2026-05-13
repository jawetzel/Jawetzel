import type { ObjectId } from "mongodb";

export interface DemoImage {
  key: string;
  url: string;
  hash: string;
  contentType: "image/png" | "image/jpeg";
  size: number;
  originalName: string | null;
  uploadedAt: Date;
}

export interface Generation {
  createdAt: Date;
  size: string;
  inputHash: string;
  inputName: string | null;
  zipUrl: string;
  previewUrl: string | null;
  // Free-form tracing-instructions hint the user supplied at generate time.
  // null when the field was left blank. Persisted so debug investigation can
  // reproduce what the AI saw on this run.
  instructions?: string | null;
}

export interface User {
  _id?: ObjectId;
  googleId: string | null;
  email: string;
  name: string;
  image: string | null;
  role: "user" | "admin";
  createdAt: Date;
  apiKeyHash: string | null;
  demo_images: DemoImage[];
  generations: Generation[];
  api_generations: Generation[];
}
