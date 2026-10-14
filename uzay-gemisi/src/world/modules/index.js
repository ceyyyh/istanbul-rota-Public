import command from './command.js';
import cryo from './cryo.js';
import quarters from './quarters.js';
import medical from './medical.js';
import lab from './lab.js';
import hydro from './hydro.js';
import engine from './engine.js';
import robotics from './robotics.js';
import cargo from './cargo.js';
import airlock from './airlock.js';
import comms from './comms.js';
import observation from './observation.js';

/** Halka sırasına göre modüller (ShipLayout.MODULE_IDS ile aynı sırada olmalı). */
export const MODULES = [command, cryo, quarters, medical, lab, hydro, engine, robotics, cargo, airlock, comms, observation];
