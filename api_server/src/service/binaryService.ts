import prisma from '../model/prisma';
import path from 'path';
import fs from 'fs';

export async function getBinaryObjectById(binaryObjectId: bigint) {
  return prisma.binary_object.findUnique({
    where: { object_id: binaryObjectId },
  });
}

/**
  * Upserts a binary object in the database.
  * returns the created or updated binary object record.
  */
export async function upsertBinaryObject(
    objectId: bigint,
    fileType: number,
    fileSize: bigint,
    storage_path: string,
) {
  return prisma.binary_object.upsert({
    where: { object_id: objectId },
    update: {
      file_type: fileType,
      file_size: fileSize,
      storage_path,
    },
    create: {
      object_id: objectId,
      file_type: fileType,
      file_size: fileSize,
      storage_path,
    },
  });
}

/**
  * @field {bigint} objectId - The ID of the object to which this binary data belongs.
  * @field {number} fileType - The type of the file (e.g., image, video).
  * @field {bigint} fileSize - The size of the file in bytes.
  * @field {string} fileSaveName - The name under which the file will be saved.
  * @field {Buffer} fileBuffer - The binary data of the file.
  */
export type UploadArgs = {
  objectId: bigint;
  fileType: number;
  fileSize: bigint;
  saveName: string;
  content: Buffer
};

/**
  * Saves a binary object to the file system and inserts its metadata into the database.
  * @param {UploadArgs} input - The upload arguments containing the object ID, file type, size, save name, and content.
  * @return {Promise<BinaryObject>} - The created binary object record.
  * @throws {Error} - If there is an error during file writing or database insertion.
  *
  * Save path structure:
  * <project_root>/data/uploads/<year>/<month>-<day>/<fileSaveName>
  */
export async function uploadBinaryObject(input: UploadArgs) {
  const storageRoot = path.join(__dirname, '../../data/uploads');
  const now = new Date();
  const dir = path.join(
      storageRoot,
      `${now.getFullYear()}`,
      `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
  );
  await fs.promises.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, input.saveName);
  await fs.promises.writeFile(filePath, input.content);
  return upsertBinaryObject(input.objectId, input.fileType, input.fileSize, filePath);
}

/**
  * Saves a chat audio file to the file system and updates the chat message record.
  * @param {UploadArgs} input - The upload arguments containing the object ID, file type, size, save name, and content.
  * @return {Promise<BinaryObject>} - The created binary object record.
  * @throws {Error} - If there is an error during file writing or database update.
  * This function is specifically for chat audio files and updates the chat message with the binary object ID.
  * The file is saved in the same structure as uploadBinaryObject.
  */
export async function uploadChatAudio(input: UploadArgs) {
  // This function can be implemented similarly to uploadBinaryObject,
  // but with specific handling for chat audio files if needed.
  const line = await uploadBinaryObject(input);
  const msg = await prisma.chat_message.update({
    where: { message_id: input.objectId },
    data: {
      has_binary: true,
      binary_object_id: line.object_id,
    },
  });
  // check if the message was updated successfully
  if (!msg) {
    throw new Error(`Failed to update chat message with ID ${input.objectId}`);
  }
  return line;
}

export type BinaryOutput = {
  objectId: bigint;
  fileType: number;
  fileSize: number;
  saveName: string;
  content: Buffer;
};

export async function readBinaryObject(objectId: bigint): Promise<BinaryOutput> {
  const line = await getBinaryObjectById(objectId);
  if (!line) {
    throw new Error(`Binary object with ID ${objectId} not found.`);
  }
  const filePath = line.storage_path;
  await fs.promises.access(filePath, fs.constants.R_OK);
  const content: Buffer = await fs.promises.readFile(filePath);
  if (content.length !== Number(line.file_size)) {
    console.error(`File size mismatch for object ID ${objectId}. Expected ${line.file_size}, got ${content.length}.`);
  }
  return {
    objectId: line.object_id,
    fileType: line.file_type,
    fileSize: content.length,
    saveName: path.basename(filePath),
    content,
  }
}


