/* Generated by res-to-ts. DO NOT EDIT */
/* eslint-disable */
/* istanbul ignore file */

import { Buffer } from 'buffer';
import { createCanvas, Image, ImageData, loadImage } from 'canvas';


/**
 * Data of data/templates/oval.png encoded as base64.
 */
const resourceDataBase64 = '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';

/**
 * MIME type of data/templates/oval.png.
 */
export const mimeType = 'image/png';

/**
 * Convert to a `data:` URL of data/templates/oval.png, suitable for embedding in HTML.
 */
export function asDataUrl() {
  return `data:${mimeType};base64,${resourceDataBase64}`;
}

/**
 * Raw data of data/templates/oval.png.
 */
export function asBuffer(): Buffer {
  return Buffer.from(resourceDataBase64, 'base64');
}

/**
 * Converts data/templates/oval.png to an `Image`.
 */
export async function asImage(): Promise<Image> {
  return await loadImage(asDataUrl());
}

/**
 * Converts data/templates/oval.png to an `ImageData`.
 */
export async function asImageData(): Promise<ImageData> {
  const image = await asImage();
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, image.width, image.height);
}