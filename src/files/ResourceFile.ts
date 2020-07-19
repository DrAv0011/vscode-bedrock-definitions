import * as path from 'path'

import * as vscode from 'vscode'

import { findNodeAtLocation, Node, parse, parseTree } from 'jsonc-parser'

import { FileType, FileData, DataTypeMap, DataType, Data } from '../handlers/FileHandler'
import { nodeToRange } from '../lib/util'

export interface BaseFile {
  format_version: string
}

export interface DescriptionObject {
  description: {
    identifier: string
  }
}

export abstract class ResourceFile {
  public abstract type: FileType
  protected abstract glob: string

  extract (document: vscode.TextDocument, node: Node, content: any): DataTypeMap {
    let response: DataTypeMap = new Map()

    response.set(DataType.Definition, this.extractIdentifiers(document, node, content))
    
    return response
  }

  protected abstract extractIdentifiers(document: vscode.TextDocument, node: Node, content: any): Data

  public async *getGlobGenerator () {
    const files = await this.getFilesFromGlob(this.glob)
    for (let file of files) {
      yield file
    }
  }

  public async extractFromAllFiles (): Promise<FileData> {
    let resp = new Map()

    let gen = this.getGlobGenerator()
    for await (let file of gen) {
      const extracted = await this.extractFromFile(file)
      resp.set(file, extracted)
    }

    return resp
  }

  public async extractFromFile (uri: vscode.Uri): Promise<DataTypeMap> {
    const { node, data, document } = await this.getAndParseFileContents(uri)
    if (node && data) {
      return this.extract(document, node, data)
    }
    return new Map()
  }

  protected getRangeFromPath (node: Node, path: (string | number)[], document: vscode.TextDocument) {
    const pointer = findNodeAtLocation(node, path)
    if (pointer) {
      return nodeToRange(pointer, document)
    }
  }

  /**
   * Verify that there is a description and identifier on an object
   * @param description The description object to verify
   */
  protected verifyDescriptionIdentifier (description: DescriptionObject) {
    return description['description'] && description['description']['identifier']
  }

  /**
   * Open and parse (with source-maps) the file specified
   * @param file the file to parse
   */
  protected async getAndParseFileContents (file: vscode.Uri): Promise<{node: Node | null, data: any, document: vscode.TextDocument}> {
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
   * Orders the provided files by the distance from the current active file
   * @param files the files to order
   */
  private orderByDistance (files: vscode.Uri[]): vscode.Uri[] {
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

  /**
   * Get and order the files from the glob pattern provided
   * @param glob the glob to find files from
   */
  private async getFilesFromGlob (glob: vscode.GlobPattern): Promise<vscode.Uri[]> {
    return this.orderByDistance(await vscode.workspace.findFiles(glob))
  }
}