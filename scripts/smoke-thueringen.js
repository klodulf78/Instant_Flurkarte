import { get_flurkarte } from "../src/infolika-thueringen.js";

const result = await get_flurkarte({
  address: "Große Arche 14, 99084 Erfurt",
  bundesland: "Thüringen"
});

console.log(JSON.stringify(result, null, 2));
