import prisma from '../model/prisma';
import path from 'path';
import fs from 'fs';

export async function getBinaryObjectById(binaryObjectId: bigint) {
  return prisma.binary_object.findUnique({
    where: { object_id: binaryObjectId },
  });
}

export async function insertBinaryObject(
    objectId: bigint,
    fileType: number,
    fileSize: bigint,
    storage_path: string,
) {
  return prisma.binary_object.create({
    data: {
      object_id: objectId,
      file_type: fileType,
      file_size: fileSize,
      storage_path: storage_path,
    },
  });
}

/*
 * Saves a binary object to the file system and inserts its metadata into the database.
 * @param {bigint} objectId - The ID of the object to which this binary data belongs.
 * @param {number} fileType - The type of the file (e.g., image, video).
 * @param {bigint} fileSize - The size of the file in bytes.
 * @param {string} fileSaveName - The name under which the file will be saved.
 * @param {Buffer} fileBuffer - The binary data of the file.
 * @return {Promise<BinaryObject>} - The created binary object record.
 * @throws {Error} - If there is an error during file writing or database insertion.
 *
* Save path structure:
* <project_root>/data/uploads/<year>/<month>-<day>/<fileSaveName>
 * */
export async function saveBinaryObject(
    objectId: bigint,
    fileType: number,
    fileSize: bigint,
    fileSaveName: string,
    fileBuffer: Buffer,
) {
  const storageRoot = path.join(__dirname, '../../data/uploads');
  const now = new Date();
  const dir = path.join(
      storageRoot,
      `{now.getFullYear()}`,
      `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
  );
  await fs.promises.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, fileSaveName);
  await fs.promises.writeFile(filePath, fileBuffer);
  return insertBinaryObject(objectId, fileType, fileSize, filePath);
}

export async function readBinaryObject(objectId: bigint) {
  const binaryObject = await getBinaryObjectById(objectId);
  if (!binaryObject) {
    throw new Error(`Binary object with ID ${objectId} not found.`);
  }
  const filePath = binaryObject.storage_path;
  await fs.promises.access(filePath, fs.constants.R_OK);
  // return stream to read the file
  return fs.createReadStream(filePath);
}


