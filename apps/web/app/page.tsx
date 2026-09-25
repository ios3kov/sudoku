import { connection } from "next/server";
import { HomeClient } from "../components/home-client";

export default async function HomePage() {
  await connection();
  return <HomeClient />;
}
