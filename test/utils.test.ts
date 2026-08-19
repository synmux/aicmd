import { test, expect } from "bun:test";
import { getVersion } from "../src/utils.ts";

test("getVersion returns this package's semver string", () => {
  expect(getVersion()).toMatch(/^\d+\.\d+\.\d+/);
});
