-- Source citation for each requirement: where it is cited in the solicitation
-- (e.g. "Section L.4.2", "PWS 3.1", "FAR 52.212-1"). Populated by the AI shred.
ALTER TABLE "dara_requirements" ADD COLUMN "citation" VARCHAR(200) NOT NULL DEFAULT '';
