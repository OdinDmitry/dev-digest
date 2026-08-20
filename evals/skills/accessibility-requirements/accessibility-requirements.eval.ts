import { describeSkill, runSkillCases } from "../../src/index.js";
import { cases } from "./accessibility-requirements.cases.js";

describeSkill("accessibility-requirements", () => runSkillCases("accessibility-requirements", cases));
