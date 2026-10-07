// AI RACE's objects, the lazy chunk `aiRace` (src/core/chunks.js): Rustmaw the robot beast
// (RobotBeast.js, robotBeastModel.js), its fireballs and fire (Fireballs.js, FireSprites.js), the
// Sporebot minions (Minions.js, minionModel.js) and the server halls (ServerHalls.js,
// serverHallModel.js). Registered in objects/kinds.js as this module is evaluated:
// ObjectManager makes them for a layout with KAIJU (the grounds), at once when they are in
// already (node tests import this module; ?test loads it before the objects are built), else
// when main attaches them (objects.attachAiRace(), once the chunk is in). The button, the boss's
// reward star, the effects and the meltdown stay in main.
import { KINDS } from './kinds.js';
import { RobotBeast } from './RobotBeast.js';
import { Fireballs } from './Fireballs.js';
import { FireSprites } from './FireSprites.js';
import { Minions } from './Minions.js';
import { ServerHalls } from './ServerHalls.js';

export const chunk = 'aiRace'; // (its lazy chunk's name: src/core/chunks.js)

KINDS.aiRace = { RobotBeast, Fireballs, FireSprites, Minions, ServerHalls };
