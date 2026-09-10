import { NextResponse } from 'next/server';
import { isOSS } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://livefolio.cloud';

  const spec = {
    openapi: "3.0.0",
    info: {
      title: "LiveFolio AI Bridge API",
      description: "API for creating, reading, and updating AI-generated interactive HTML documents (folios). Used by ChatGPT Actions, Claude connectors, and Microsoft Copilot.",
      version: "1.0.0"
    },
    servers: [
      {
        url: baseUrl,
        description: isOSS ? "Local Development Server" : "LiveFolio Cloud Production"
      }
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "Authorization",
          description: "Enter your LiveFolio_API_KEY as 'Bearer <key>'"
        }
      },
      schemas: {
        ProjectSummary: {
          type: "object",
          properties: {
            project_id: { type: "string" },
            title: { type: "string" },
            description: { type: "string" },
            file_count: { type: "integer" },
            version_count: { type: "integer" },
            open_comments: { type: "integer" },
            updated_at: { type: "string", format: "date-time" },
            share_url: { type: "string" },
            studio_url: { type: "string" }
          }
        },
        ProjectDetail: {
          type: "object",
          properties: {
            project_id: { type: "string" },
            title: { type: "string" },
            description: { type: "string" },
            current_files: {
              type: "object",
              additionalProperties: { type: "string" }
            },
            version_history: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  versionId: { type: "string" },
                  commitMessage: { type: "string" },
                  author: { type: "string" },
                  createdAt: { type: "string" },
                  fileNames: { type: "array", items: { type: "string" } }
                }
              }
            },
            open_comments: { type: "array", items: { type: "object" } }
          }
        }
      }
    },
    security: [
      { ApiKeyAuth: [] }
    ],
    paths: {
      "/api/files": {
        get: {
          operationId: "list_projects",
          summary: "List all existing LiveFolio projects",
          responses: {
            "200": {
              description: "A list of project summaries",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/ProjectSummary" }
                  }
                }
              }
            }
          }
        },
        post: {
          operationId: "create_project",
          summary: "Create a new LiveFolio project",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    description: { type: "string" },
                    initial_html: { type: "string" },
                    project_mode: { type: "string", enum: ["deck", "document", "spreadsheet", "dashboard"] }
                  },
                  required: ["title", "initial_html"]
                }
              }
            }
          },
          responses: {
            "201": {
              description: "Project created successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      project_id: { type: "string" },
                      share_url: { type: "string" }
                    }
                  }
                }
              }
            }
          }
        }
      },
      "/api/files/{id}": {
        get: {
          operationId: "get_project",
          summary: "Get full details of a specific project",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" }
            }
          ],
          responses: {
            "200": {
              description: "The project details",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ProjectDetail" }
                }
              }
            }
          }
        },
        put: {
          operationId: "update_project",
          summary: "Update files in a project",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" }
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    files: {
                      type: "object",
                      additionalProperties: { type: "string" }
                    },
                    commitMessage: { type: "string" }
                  },
                  required: ["files", "commitMessage"]
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Project updated successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      versionId: { type: "string" }
                    }
                  }
                }
              }
            }
          }
        }
      },
      "/api/files/{id}/brief": {
        get: {
          operationId: "get_curated_brief",
          summary: "Get a structured design brief based on feedback pins",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" }
            }
          ],
          responses: {
            "200": {
              description: "The design brief in markdown format",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      brief: { type: "string" }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  };

  return NextResponse.json(spec);
}
