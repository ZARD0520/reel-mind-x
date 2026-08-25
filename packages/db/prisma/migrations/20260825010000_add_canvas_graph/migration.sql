ALTER TABLE "canvases"
ADD COLUMN "graph" JSONB NOT NULL
DEFAULT '{"version":1,"nodes":[],"edges":[],"viewport":{"x":0,"y":0,"zoom":1}}';
