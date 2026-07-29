import test from "node:test";
import assert from "node:assert/strict";
import { isSafeSvgText } from "../src/services/uploadValidation.js";

test("SVG validation permits passive graphics and rejects active or external content", () => {
  assert.equal(isSafeSvgText('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>'), true);
  for (const unsafe of [
    "<svg><script>alert(1)</script></svg>",
    '<svg><rect onclick="alert(1)"/></svg>',
    "<svg><foreignObject><div>html</div></foreignObject></svg>",
    '<svg><image href="https://attacker.example/pixel"/></svg>',
    '<svg><use xlink:href="//attacker.example/icon"/></svg>',
    '<svg><image href="data:image/svg+xml;base64,AAA"/></svg>',
    "<svg><style>@import url(https://attacker.example/x.css)</style></svg>",
    '<svg><rect style="fill:url(javascript:alert(1))"/></svg>',
    "<!DOCTYPE svg [<!ENTITY x SYSTEM 'file:///etc/passwd'>]><svg>&x;</svg>",
    "<svg><iframe/></svg>",
    "<svg><object/></svg>",
    "<svg><embed/></svg>"
  ]) {
    assert.equal(isSafeSvgText(unsafe), false, unsafe);
  }
});
