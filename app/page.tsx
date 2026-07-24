import type { Metadata } from "next";
import { AssessmentWorkspace } from "./workspace";

export const metadata: Metadata = {
  title: "GovernAI — RAG Compliance Assessment",
  description:
    "Standard-driven governance, security, and compliance evaluation for retrieval-augmented AI systems.",
};

export default function Home() {
  return <AssessmentWorkspace />;
}

