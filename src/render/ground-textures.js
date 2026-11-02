// How the game draws each ground type (docs/rendering.md#grounds), as data.
//
// Ground types drawn from 40x40 tiles ("$T_n" symbols of the game resources). `fill.tiles` are picked at random per cell;
// with `edge`: when the ground width is a multiple of 40 the top row between the corners uses `edge.tiles`, the corners use
// `edge.corners` and the columns below them use `corners.left/right`; otherwise the whole top row uses `edge.tiles`.
// `topRow` (types 15 and 21) lists top-row passes that always run, in order; `fill.fromRow` starts the random fill below
// the top row. `flat` is what the game draws instead of any texture in minimalist mode or, for types 12 to 14, the whole drawing.
//
// `isPregenerated` decides two things: a pre-generated ground uses a pre-rendered bitmap for `pregenerated` types
// ("S" family: 400x400, or 100x100 when width or height is under 20; `PREGENERATED_SYMBOLS[pregenerated]`) and gets no `overlay`;
// a ground without it draws the vector `symbol` clip and, for tiled types, gets the `$E_1` overlay (`overlayBlend`) stretched over
// the whole ground. A ground is pre-generated when it is dynamic, when its width or height is over 1400, and in slow mode
// (average FPS under 35) or the mobile version. An offline renderer has neither, so `forced` defaults to false. Types missing here (16 and above 21) fall through to the `$Sol_Dur` vector clip stretched to the ground size.
export const GROUND_TEXTURE_RECIPES = Object.freeze({
  "0": {
    "type": 0,
    "flat": {
      "color": 3294800
    },
    "symbol": "$Sol_Dur",
    "pregenerated": 0
  },
  "1": {
    "type": 1,
    "flat": {
      "color": 9021429
    },
    "symbol": "$Glacon",
    "pregenerated": 1
  },
  "2": {
    "type": 2,
    "flat": {
      "color": 7163540
    },
    "symbol": "$Sol_Rebond",
    "pregenerated": 3
  },
  "3": {
    "type": 3,
    "flat": {
      "color": 14174209
    },
    "fill": {
      "tiles": [
        1,
        2,
        3
      ]
    },
    "overlay": "$E_1",
    "overlayBlend": "overlay"
  },
  "4": {
    "type": 4,
    "flat": {
      "color": 3021068
    },
    "symbol": "$Sol_Chocolat",
    "pregenerated": 4
  },
  "5": {
    "type": 5,
    "flat": {
      "color": 3294800
    },
    "fill": {
      "tiles": [
        4,
        5
      ]
    },
    "overlay": "$E_1",
    "overlayBlend": "overlay"
  },
  "6": {
    "type": 6,
    "flat": {
      "color": 3294800
    },
    "fill": {
      "tiles": [
        4,
        5
      ]
    },
    "edge": {
      "tiles": [
        6,
        7
      ],
      "corners": {
        "topLeft": 9,
        "topRight": 8,
        "left": 10,
        "right": 11
      }
    },
    "overlay": "$E_1",
    "overlayBlend": "overlay"
  },
  "7": {
    "type": 7,
    "flat": {
      "color": 3294800
    },
    "fill": {
      "tiles": [
        0,
        12
      ]
    },
    "overlay": "$E_1",
    "overlayBlend": "overlay"
  },
  "8": {
    "type": 8,
    "flat": {
      "color": 13492706,
      "alpha": 0.5
    },
    "pregenerated": 2
  },
  "9": {
    "type": 9,
    "flat": {
      "color": 7186351,
      "alpha": 0.3
    },
    "fill": {
      "tiles": [
        15,
        16
      ]
    }
  },
  "10": {
    "type": 10,
    "flat": {
      "color": 3294800
    },
    "fill": {
      "tiles": [
        17,
        18
      ]
    },
    "edge": {
      "tiles": [
        20
      ],
      "corners": {
        "topLeft": 19,
        "topRight": 21,
        "left": 22,
        "right": 23
      }
    },
    "overlay": "$E_1",
    "overlayBlend": "overlay"
  },
  "11": {
    "type": 11,
    "flat": {
      "color": 15200498
    },
    "fill": {
      "tiles": [
        4,
        5
      ]
    },
    "edge": {
      "tiles": [
        25,
        26
      ],
      "corners": {
        "topLeft": 24,
        "topRight": 27,
        "left": 10,
        "right": 11
      }
    },
    "overlay": "$E_1",
    "overlayBlend": "overlay"
  },
  "12": {
    "type": 12,
    "flat": {
      "color": "ground"
    }
  },
  "13": {
    "type": 13,
    "flat": {
      "color": "ground",
      "shape": "circle"
    }
  },
  "14": {
    "type": 14,
    "flat": {
      "color": 0,
      "alpha": 0
    }
  },
  "15": {
    "type": 15,
    "flat": {
      "color": 9542300,
      "alpha": 0.3
    },
    "fill": {
      "tiles": [
        28
      ],
      "fromCol": 0,
      "fromRow": 1
    },
    "topRow": [
      {
        "tiles": [
          28
        ],
        "into": "ground"
      }
    ]
  },
  "17": {
    "type": 17,
    "flat": {
      "color": 3294800
    },
    "fill": {
      "tiles": [
        4,
        5
      ]
    },
    "edge": {
      "tiles": [
        29,
        30
      ],
      "corners": {
        "topLeft": 32,
        "topRight": 31,
        "left": 33,
        "right": 34
      }
    },
    "overlay": "$E_1",
    "overlayBlend": "overlay"
  },
  "18": {
    "type": 18,
    "flat": {
      "color": 3294800
    },
    "fill": {
      "tiles": [
        4,
        5
      ]
    },
    "edge": {
      "tiles": [
        35,
        36
      ],
      "corners": {
        "topLeft": 38,
        "topRight": 37,
        "left": 39,
        "right": 40
      }
    },
    "overlay": "$E_1",
    "overlayBlend": "overlay"
  },
  "19": {
    "type": 19,
    "flat": {
      "color": 5350167
    },
    "fill": {
      "tiles": [
        41,
        42
      ]
    },
    "edge": {
      "tiles": [
        43,
        44
      ],
      "corners": {
        "topLeft": 46,
        "topRight": 45,
        "left": 47,
        "right": 48
      }
    },
    "overlay": "$E_1",
    "overlayBlend": "overlay"
  },
  "20": {
    "type": 20,
    "flat": {
      "color": 16438791
    },
    "fill": {
      "tiles": [
        49,
        50
      ]
    },
    "edge": {
      "tiles": [
        51
      ],
      "corners": {
        "topLeft": 53,
        "topRight": 52,
        "left": 54,
        "right": 55
      }
    },
    "overlay": "$E_1",
    "overlayBlend": "overlay"
  },
  "21": {
    "type": 21,
    "flat": {
      "color": 2293844,
      "alpha": 0.3
    },
    "fill": {
      "tiles": [
        60,
        61
      ],
      "fromCol": 0,
      "fromRow": 1
    },
    "topRow": [
      {
        "tiles": [
          56,
          58
        ],
        "into": "strip"
      },
      {
        "tiles": [
          56,
          58
        ],
        "into": "ground"
      },
      {
        "tiles": [
          57,
          59
        ],
        "into": "ground"
      }
    ]
  }
});

export const TILE_SIZE = 40;
export const PREGENERATED_SYMBOLS = Object.freeze(["$Sol_Dur", "$Glacon", "$Transparent", "$Sol_Rebond", "$Sol_Chocolat"]);
export const DEFAULT_GROUND_SYMBOL = "$Sol_Dur";
/**
 * Whether the game draws the ground from a pre-rendered bitmap: true for dynamic grounds, for grounds over 1400 px, and when `forced` (slow mode or the mobile version, both false for an offline renderer).
 * @param {{dynamic:boolean, width:number, height:number, forced?:boolean}} ground
 */
export function isPregenerated({ dynamic, width, height, forced = false }) {
  return Boolean(dynamic) || width > 1400 || height > 1400 || Boolean(forced);
}
export const tileSymbol = (n) => `$T_${n}`;
