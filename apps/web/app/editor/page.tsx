import type { Metadata } from "next";
import { CmsWorkspace } from "@/components/cms/cms-workspace";

export const metadata: Metadata = {
  title: "Editor",
  description: "Write and publish to your AT Protocol publications with AnyPub.",
  robots: { index: false, follow: false },
};

export default function Editor() {
  return <CmsWorkspace />;
}
