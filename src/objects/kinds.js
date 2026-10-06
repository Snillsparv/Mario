// Object kinds that live in a lazy chunk (src/core/chunks.js), registered by their own module as
// it is evaluated: objects/Critters.js (the skerries chunk) sets KINDS.Critters. ObjectManager
// makes a layout's things from here, so main never imports them.
//
//   KINDS.Critters   // a course's critters (layout.CRITTERS), once its chunk is in

export const KINDS = {};
