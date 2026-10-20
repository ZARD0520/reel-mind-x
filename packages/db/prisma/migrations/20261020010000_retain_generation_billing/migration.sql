-- Generation history backs the credit ledger and survives deletion of its creative scope.
ALTER TABLE "generation_tasks" DROP CONSTRAINT "generation_tasks_canvasId_fkey";
ALTER TABLE "generation_tasks" ADD CONSTRAINT "generation_tasks_canvasId_fkey"
  FOREIGN KEY ("canvasId") REFERENCES "canvases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "generation_tasks" DROP CONSTRAINT "generation_tasks_projectId_fkey";
ALTER TABLE "generation_tasks" ADD CONSTRAINT "generation_tasks_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
