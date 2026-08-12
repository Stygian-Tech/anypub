import type { Metadata } from "next";
import { LoginPage } from "@/components/login-page";

export const metadata: Metadata = {
  title: "Log in",
  description: "Connect your AT Protocol account to AnyPub.",
};

export default function Login() {
  return <LoginPage />;
}
