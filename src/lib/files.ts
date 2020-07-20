import * as path from 'path'

import * as vscode from 'vscode'

import { Node, parse, parseTree } from 'jsonc-parser'

/**
 * Open and parse (with source-maps) the file specified
 * @param file the file to parse
 */
async function getAndParseFileContents (file: vscode.Uri): Promise<{node: Node | null, data: any, document: vscode.TextDocument}> {
  const document = await vscode.workspace.openTextDocument(file)
  const textContent = document.getText()

  try {
    return {
      document,
      data: parse(textContent),
      node: parseTree(textContent)
    }
  } catch (e) {
    return {
      document,
      data: null,
      node: null
    }
  }
}

/**
 * Get and order the files from the glob pattern provided
 * @param glob the glob to find files from
 */
async function getOrderedFilesFromGlob (glob: vscode.GlobPattern): Promise<vscode.Uri[]> {
  return orderByDistance(await vscode.workspace.findFiles(glob))
}

/**
 * Orders the provided files by the distance from the current active file
 * @param files the files to order
 */
function orderByDistance (files: vscode.Uri[]): vscode.Uri[] {
  if (vscode.window.activeTextEditor?.document) {
    const document = vscode.window.activeTextEditor.document
    const currentFile = document.fileName
    const sortedFiles = files.sort(({ path: aPath }, { path: bPath }) => {
      // get the closest file basded on the relative location of it and order
      const relativeToA = path.relative(currentFile, aPath).split(path.sep)
      const relativeToB = path.relative(currentFile, bPath).split(path.sep)
      return relativeToA.length - relativeToB.length
    })
    return sortedFiles
  }
  return files
}

export { getAndParseFileContents, getOrderedFilesFromGlob }
