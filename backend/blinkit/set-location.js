async function setBlinkitLocation(page, loc) {
  console.log(`Setting Blinkit location to: ${loc}`);
  try {
    if (!page.url().includes("blinkit.com")) {
      await page.goto("https://blinkit.com/", {
        waitUntil: "domcontentloaded",
        timeout: 300000,
      });
    }
    const locationInputSelectors = [
      '[name="select-locality"]',
      '[placeholder*="Search"]',
      'input[type="text"]',
    ];

    const locationInput = await findFirstSelector(page, locationInputSelectors, 20000);
    if (!locationInput) {
      throw new Error("Location input not found on Blinkit");
    }

    await page.click(locationInput).catch(() => {});
    await page
      .waitForFunction(
        (selector) => {
          const element = document.querySelector(selector);
          return element && !element.disabled;
        },
        { timeout: 20000 },
        locationInput
      )
      .catch(() => console.log("Proceeded without confirmation of enabled input"));

    await page.type(locationInput, loc);
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const suggestionSelectors = [
        ".LocationSearchList__LocationListContainer-sc-93rfr7-0:nth-child(1)",
        '[class*="LocationSearchList"]',
        '[class*="LocationList"]',
        '[class*="LocationSearch"]',
      ];
      const suggestion = await findFirstSelector(page, suggestionSelectors, 10000);
      if (suggestion) {
        await page.click(suggestion);
      } else {
        await page.$$eval('[class*="Location"]', (elements) => {
          if (elements.length > 0) elements[0].click();
        });
      }
    } catch (err) {
      console.log("Failed selecting first location suggestion, trying Enter key");
      await page.keyboard.press("Enter").catch(() => {});
    }

    await new Promise((r) => setTimeout(r, 3000));
    await page
      .waitForFunction(
        () =>
          !document.querySelector('[class*="LocationSearchList"]') &&
          !document.querySelector('[class*="LocationList"]'),
        { timeout: 8000 }
      )
      .catch(() => {});

    let locTitle = await isLocationSet(page, loc);
    if (locTitle && locTitle !== "400") {
      console.log(`Location successfully set to: ${locTitle}`);
      return locTitle;
    } else {
      console.log(`Failed to verify location after setting to: ${loc}`);
      return null;
    }
  } catch (err) {
    console.error("Error setting Blinkit location:", err);
    return null;
  }
}

async function isLocationSet(page, fallbackValue) {
  console.log("Checking if location is set by looking for location labels...");
  const selectors = [
    '[class^="LocationBar__Subtitle-"]',
    '[class*="LocationBar__Subtitle"]',
    '[data-testid="header-location"]',
    '[data-testid*="location"]',
    '[class*="LocationBar"] [class*="Subtitle"]',
  ];

  try {
    const txt = await getFirstTextFromSelectors(page, selectors, 8000);
    if (txt) {
      console.log(`Location title found: "${txt}"`);
      return txt;
    }

    if (fallbackValue) {
      console.log("Falling back to provided location value");
      return fallbackValue;
    }
    return "400";
  } catch (err) {
    console.log("Location not found via selectors.");
    return fallbackValue || "400";
  }
}

module.exports = {
  setBlinkitLocation,
  isLocationSet,
};

async function findFirstSelector(page, selectors, timeout) {
  for (const sel of selectors) {
    try {
      await page.waitForSelector(sel, { timeout });
      return sel;
    } catch (e) {
      // try next selector
    }
  }
  return null;
}

async function getFirstTextFromSelectors(page, selectors, timeout) {
  for (const sel of selectors) {
    try {
      await page.waitForSelector(sel, { timeout });
      const txt = await page.$eval(sel, (el) => el.textContent.trim());
      if (txt && !/select|enter/i.test(txt)) {
        return txt;
      }
    } catch (e) {
      // try next selector
    }
  }
  return "";
}
