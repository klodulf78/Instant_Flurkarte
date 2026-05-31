import test from "node:test";
import assert from "node:assert/strict";
import { parseAddressInput, FlurkarteError } from "../src/infolika-thueringen.js";

test("parses supported German address formats", () => {
  const cases = [
    ["Große Arche 14, Erfurt", { street: "Große Arche", houseNumber: "14", postalCode: null, town: "Erfurt" }],
    ["Große Arche 14 Erfurt", { street: "Große Arche", houseNumber: "14", postalCode: null, town: "Erfurt" }],
    ["99084 Erfurt, Große Arche 14", { street: "Große Arche", houseNumber: "14", postalCode: "99084", town: "Erfurt" }],
    ["Große Arche 14", { street: "Große Arche", houseNumber: "14", postalCode: null, town: "Erfurt" }],
    ["Erfurt Große Arche 14", { street: "Große Arche", houseNumber: "14", postalCode: null, town: "Erfurt" }],
    ["99084 Große Arche 14", { street: "Große Arche", houseNumber: "14", postalCode: "99084", town: "Erfurt" }]
  ];

  for (const [input, expected] of cases) {
    assert.deepEqual(parseAddressInput(input), expected);
  }
});

test("keeps the existing canonical address format", () => {
  assert.deepEqual(parseAddressInput("Große Arche 14, 99084 Erfurt"), {
    street: "Große Arche",
    houseNumber: "14",
    postalCode: "99084",
    town: "Erfurt"
  });
});

test("throws a friendly validation error for incomplete input", () => {
  assert.throws(
    () => parseAddressInput("Große Arche"),
    (error) => error instanceof FlurkarteError
      && error.code === "INVALID_ADDRESS"
      && error.message === "Please enter a street, house number and city in Thüringen."
  );
});
