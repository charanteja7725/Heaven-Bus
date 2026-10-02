# HEAVEN-BUS Playwright Functional Testing

HEAVEN-BUS uses Playwright with TypeScript for browser-level functional testing.

## What Playwright proves

The tests interact with the application like a real passenger. They open the browser, click controls, type values, navigate routes, wait for API-backed UI updates, and assert the final result.

The main end-to-end journey covers:

1. Open HEAVEN-BUS.
2. Open Sign in.
3. Create a passenger account.
4. Search Bengaluru to Chennai.
5. Choose a bus.
6. Select passenger gender and a seat.
7. Verify the five-minute hold.
8. Continue to passenger details.
9. Enter passenger name, age, contact number and notification email.
10. Continue to sandbox payment.
11. Confirm payment.
12. Verify the confirmed ticket survives a page reload.
13. Open Live Journey.
14. Verify the passenger location experience.

Additional functional and edge-case tests cover authentication, invalid credentials, protected pages, route autocomplete, family seating, gender restrictions, six-seat limits, live seat contention, Jarvis, admin trip creation, mobile layout and GPS.

## Commands

Install dependencies:

```bash
npm ci
npx playwright install chromium
```

Run all Playwright tests and see the pass/fail count in the terminal:

```bash
npm run test:e2e
```

Open Playwright's interactive UI so an interviewer can select a test and watch every step:

```bash
npm run test:e2e:ui
```

Run tests in a visible browser:

```bash
npx playwright test --headed
```

Open the HTML report after a test run:

```bash
npm run test:e2e:report
```

## How to demonstrate it in an interview

Use `npm run test:e2e:ui`.

Select the full passenger journey test:

**passenger registers, searches, holds, pays and prints a persistent ticket**

Press Run. Playwright will execute the complete flow in Chromium.

Then run the complete suite. At the end, show the Playwright result summary with the number of passed and failed functional tests.

The CI pipeline also runs:

- TypeScript / production build
- Vitest backend and integration tests
- Playwright functional browser tests
- HTML report generation

The generated Playwright report is uploaded as a GitHub Actions artifact named **browser-verification**.
