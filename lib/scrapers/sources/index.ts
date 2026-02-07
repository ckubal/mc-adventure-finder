import { registerScraper } from "../registry";
import { greenAppleScraper } from "./greenapple";
import { booksmithScraper } from "./booksmith";
import { mannysScraper } from "./mannys";
import { grayAreaScraper } from "./grayarea";
import { independentScraper } from "./independent";
import { rickshawScraper } from "./rickshaw";
import { cafeDuNordScraper } from "./cafedunord";
import { envelopScraper } from "./envelop";
import { brickAndMortarScraper } from "./brickandmortar";
import { makeOutRoomScraper } from "./makeoutroom";
import { cobbsScraper } from "./cobbs";
import { punchLineScraper } from "./punchline";
import { funcheapScraper } from "./funcheap";
import { bottomOfTheHillScraper } from "./bottomofthehill";
import { sfjazzScraper } from "./sfjazz";

export function registerAllScrapers(): void {
  registerScraper(greenAppleScraper);
  registerScraper(booksmithScraper);
  registerScraper(mannysScraper);
  registerScraper(grayAreaScraper);
  registerScraper(independentScraper);
  registerScraper(rickshawScraper);
  registerScraper(cafeDuNordScraper);
  registerScraper(envelopScraper);
  registerScraper(brickAndMortarScraper);
  registerScraper(makeOutRoomScraper);
  registerScraper(cobbsScraper);
  registerScraper(punchLineScraper);
  registerScraper(funcheapScraper);
  registerScraper(bottomOfTheHillScraper);
  registerScraper(sfjazzScraper);
}

export {
  greenAppleScraper,
  booksmithScraper,
  mannysScraper,
  grayAreaScraper,
  independentScraper,
  rickshawScraper,
  cafeDuNordScraper,
  envelopScraper,
  brickAndMortarScraper,
  makeOutRoomScraper,
  cobbsScraper,
  punchLineScraper,
  funcheapScraper,
  bottomOfTheHillScraper,
  sfjazzScraper,
};
