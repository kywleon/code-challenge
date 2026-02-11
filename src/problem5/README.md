# Problem 5: Resource Management API

A RESTful API for managing resources built with Express.js, TypeORM, and SQLite.

## Overview

This is a simple REST API application that provides CRUD operations (Create, Read, Update, Delete) for managing resources. The backend uses:

- **Framework**: Express.js
- **ORM**: TypeORM
- **Database**: SQLite
- **Language**: TypeScript
- **Additional Libraries**: CORS, body-parser, dotenv

## Project Structure

```
src/
  ├─ app.ts                 # Express app setup, database initialization
  ├─ server.ts              # Server entry point
  ├─ controllers/
  │  └─ resourceController.ts  # Business logic for resource operations
  ├─ models/
  │  └─ resource.ts         # Resource entity (TypeORM)
  └─ routes/
     └─ resourceRoutes.ts    # API routes definition
```

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn

## Installation

1. **Clone / Navigate to the repository**:

```bash
cd src/problem5
```

2. **Install dependencies**:

```bash
npm install
```

Dependencies include:

- `express` — Web framework
- `typeorm` — ORM for database
- `sqlite3` — SQLite driver
- `cors` — Cross-origin resource sharing
- `body-parser` — Middleware for parsing JSON
- `dotenv` — Environment variable management
- `reflect-metadata` — Decorators support for TypeORM
- `typescript`, `ts-node` — TypeScript support

3. **Environment Setup** (Optional):

   Create a `.env` file in the repository root (if not already present):

   ```
   PORT=3000
   ```

   - `PORT` — Server port (default: 3000)

## Configuration

The application is configured in `src/app.ts`:

- **Database Type**: SQLite
- **Database File**: `db.sqlite` (created automatically in the root directory)
- **ORM Sync**: Enabled (automatically creates/updates tables based on entities)
- **CORS**: Enabled (allows cross-origin requests)

## Running the Application

### Development Mode (with auto-reload)

```bash
npm run test:problem5
```

This uses `ts-node-dev` for automatic server restart on file changes.

### Server Output

When the server starts successfully, you should see:

```
Database connected
Server running at http://localhost:3000
```

## API Endpoints

### Base URL

```
http://localhost:3000/resources
```

### Endpoints

#### 1. Create a Resource

- **Method**: `POST`
- **URL**: `/resources`
- **Body**:
  ```json
  {
    "name": "Resource Name",
    "description": "Optional description"
  }
  ```
- **Response** (201 Created):
  ```json
  {
    "id": 1,
    "name": "Resource Name",
    "description": "Optional description"
  }
  ```

#### 2. List All Resources

- **Method**: `GET`
- **URL**: `/resources`
- **Query Parameters** (optional):
  - `name` — Filter by resource name (e.g., `/resources?name=test`)
- **Response** (200 OK):
  ```json
  [
    {
      "id": 1,
      "name": "Resource Name",
      "description": "Optional description"
    },
    ...
  ]
  ```

#### 3. Get a Specific Resource

- **Method**: `GET`
- **URL**: `/resources/:id`
- **Response** (200 OK):
  ```json
  {
    "id": 1,
    "name": "Resource Name",
    "description": "Optional description"
  }
  ```
- **Response** (404 Not Found):
  ```json
  {
    "error": "Not found"
  }
  ```

#### 4. Update a Resource

- **Method**: `PUT`
- **URL**: `/resources/:id`
- **Body** (partial update allowed):
  ```json
  {
    "name": "Updated Name",
    "description": "Updated description"
  }
  ```
- **Response** (200 OK):
  ```json
  {
    "id": 1,
    "name": "Updated Name",
    "description": "Updated description"
  }
  ```

#### 5. Delete a Resource

- **Method**: `DELETE`
- **URL**: `/resources/:id`
- **Response** (200 OK):
  ```json
  {
    "message": "Deleted successfully"
  }
  ```

## Testing the API

You can test the API using:

- **cURL** (command line):

  ```bash
  curl -X GET http://localhost:3000/resources
  curl -X POST http://localhost:3000/resources \
    -H "Content-Type: application/json" \
    -d '{"name":"Test","description":"A test resource"}'
  ```

- **Postman** — Import the endpoint URL and test each operation
- **VS Code REST Client** — Create a `.rest` file with test requests

## Database

- **Type**: SQLite
- **File**: `db.sqlite` (automatically created)
- **Entity**: `Resource` with fields:
  - `id` (Primary Key, auto-incremented)
  - `name` (String, required)
  - `description` (String, optional)

## Troubleshooting

### Port Already in Use

If port 3000 is already in use, set a different port in `.env`:

```
PORT=3001
```

### Database Connection Error

Ensure the application has write permissions in the directory (for SQLite database file creation).

### Module Not Found Error

Run `npm install` to ensure all dependencies are installed.

### TypeScript Compilation Error

Ensure TypeScript and ts-node are installed:

```bash
npm install typescript ts-node --save-dev
```

## Development Notes

- **Entity Updates**: If you modify the `Resource` model, restart the server to sync the database.
- **Error Handling**: All endpoints return appropriate HTTP status codes and error messages.
- **Request Body**: All POST/PUT requests require `Content-Type: application/json` header.

## Summary

This API provides a complete resource management system with full CRUD capabilities. Follow the installation and setup steps above to get the application running locally, then use the provided endpoint documentation to integrate or test the API.
