import path from "node:path";
import { chromium } from "playwright";
import { fillKnownFields, type FillPayload } from "../src/lib/kazi/fill-form";

const payload: FillPayload = {
  fullName: "Maya Okonkwo",
  firstName: "Maya",
  lastName: "Okonkwo",
  email: "maya.okonkwo@example.com",
  phone: "555-0100",
  location: "Brooklyn, NY",
  linkedIn: "",
  coverLetter: "Dear Hiring Team,\n\nI am applying for the role.\n\nSincerely,\nMaya Okonkwo",
};

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(pathToFileURL(path.resolve("scripts/fixtures/ats-form.html")));
  const filled = await fillKnownFields(page, payload);
  const submitted = await page.evaluate(() => (window as unknown as { __submitted?: boolean }).__submitted === true);
  const email = await page.locator("#email").inputValue();
  const cover = await page.locator("#cover").inputValue();
  await browser.close();

  if (submitted) throw new Error("The filler clicked Submit.");
  if (email !== payload.email || !cover.includes("Dear Hiring Team")) {
    throw new Error(`Fields were not filled. email=${email}`);
  }
  if (!filled.includes("email") || !filled.includes("coverLetter")) {
    throw new Error(`Expected email and cover letter to be filled, got ${filled.join(", ")}`);
  }
  console.log("fill-form smoke ok:", filled.join(", "));
}

main();

function pathToFileURL(file: string): string {
  return "file://" + file;
}
