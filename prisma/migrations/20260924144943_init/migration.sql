-- CreateTable
CREATE TABLE "project_state" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Projeto sem título',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "project_hash" TEXT NOT NULL,
    "document" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "revisions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual_json',
    "note" TEXT,
    "element_count" INTEGER NOT NULL DEFAULT 0,
    "document" TEXT NOT NULL,
    "saved_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "revisions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project_state" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ai_provider_config" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "api_key" TEXT,
    "model" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" TEXT,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "custom_presets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "document" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "examples" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "document" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "project_state_project_id_key" ON "project_state"("project_id");

-- CreateIndex
CREATE INDEX "project_state_updated_at_idx" ON "project_state"("updated_at");

-- CreateIndex
CREATE INDEX "revisions_project_id_saved_at_idx" ON "revisions"("project_id", "saved_at");

-- CreateIndex
CREATE UNIQUE INDEX "revisions_project_id_revision_key" ON "revisions"("project_id", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "ai_provider_config_provider_key" ON "ai_provider_config"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "custom_presets_slug_key" ON "custom_presets"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "examples_slug_key" ON "examples"("slug");
