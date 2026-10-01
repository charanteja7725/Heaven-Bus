import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});
test("passenger registers, searches, holds, pays and prints a persistent ticket", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Full name").fill("Journey Tester");
  await page
    .getByLabel("Email address")
    .fill(`journey-${Date.now()}@example.test`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Journey-test-password-2026");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page).toHaveURL(/bookings/);
  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString("en-CA", {
    timeZone: "Asia/Kolkata",
  });
  await page.goto(`/search?from=Bengaluru&to=Chennai&date=${tomorrow}`);
  await page.getByRole("link", { name: "Choose seats" }).first().click();
  await page
    .getByRole("button", { name: "Seat 1A, available", exact: true })
    .click();
  await expect(page.getByText("These seats are yours for")).toBeVisible();
  await page.getByRole("button", { name: "Continue to passengers" }).click();
  await page.getByLabel("Full name").fill("Journey Tester");
  await page.getByLabel("Age", { exact: true }).fill("24");
  await page.getByLabel("Contact number").fill("9876543210");
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await page.reload();
  await page.getByRole("button", { name: /Simulate payment/ }).click();
  await expect(
    page.getByRole("heading", { name: "You’re on your way." }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText("Seat 1A", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "test-results/confirmed-ticket.png",
    fullPage: true,
  });
});
test("Jarvis returns inventory and follows up on a budget", async ({
  page,
}) => {
  await page.goto("/");
  await page.screenshot({
    path: "test-results/desktop-home.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Let’s talk travel" }).click();
  await page
    .getByLabel("Message Jarvis")
    .fill("Bengaluru to Chennai tomorrow under ₹1,000");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator(".jarvis-trip").first()).toBeVisible();
  await page.screenshot({ path: "test-results/jarvis-search.png" });
  await page.getByLabel("Message Jarvis").fill("under 500");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByText(/couldn’t find an available trip/)).toBeVisible();
});
test("admin sees operations and can publish a trip", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email address").fill("admin@heaven.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Local-test-password-2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("link", { name: "Operations" }).click();
  await expect(
    page.getByRole("heading", { name: "Keep every journey moving." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create trip" }).click();
  await page.getByLabel("Origin", { exact: true }).fill("Bengaluru");
  await page.getByLabel("Destination", { exact: true }).fill("Chennai");
  const date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 16);
  await page.getByLabel("Departure in IST").fill(date);
  await page.getByLabel("Duration in hours").fill("6");
  await page.getByLabel("Fare in rupees").fill("800");
  await page.getByRole("button", { name: "Publish departure" }).click();
  await expect(page.getByRole("status")).toContainText("Trip published");
});
test("mobile landing page has no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Somewhere good/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/mobile-home.png",
    fullPage: true,
  });
});

test("another traveller sees holds and releases through live updates", async ({
  page,
  browser,
}) => {
  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString("en-CA", {
    timeZone: "Asia/Kolkata",
  });
  const response = await page.request.post("/api/auth/register", {
    data: {
      name: "Live Tester",
      email: `live-${Date.now()}@example.test`,
      password: "Live-test-password-2026",
    },
  });
  expect(response.ok()).toBe(true);
  const { token } = await response.json();
  await page.goto("/");
  await page.evaluate(
    (value) => sessionStorage.setItem("hb-token", value),
    token,
  );
  await page.goto(`/search?from=Mumbai&to=Pune&date=${tomorrow}`);
  await page.getByRole("link", { name: "Choose seats" }).first().click();
  const observer = await browser.newContext();
  const other = await observer.newPage();
  await other.goto(page.url());
  await expect(
    other.getByText("Live seat updates", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Seat 1A, available", exact: true })
    .click();
  await expect(
    other.getByRole("button", { name: "Seat 1A, held", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Release my seats", exact: true })
    .click();
  await expect(
    other.getByRole("button", { name: "Seat 1A, available", exact: true }),
  ).toBeEnabled();
  await observer.close();
});
