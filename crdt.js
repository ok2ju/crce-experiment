import Identifier from './identifier'
import Char from './char'


const document = [
  ['M', 'u', 'l', 't', 'i', 'p', 'l', 'e', ' ', 'l', 'i', 'n', 'e', 's'],
  ['a', 'r', 'e', ' ', 's', 'i', 'm', 'i', 'l', 'a', 'r'],
  ['t', 'o', ' ', 'a', 'n', ' ', 'a', 'r', 'r', 'a', 'y', ' ', 'o', 'f', ' ', 'a', 'r', 'r', 'a', 'y', 's', '.']
]

class CRDT {
  constructor(id) {
    this.siteId = id
    this.struct = [[]]
  }

  // position: { line: number, ch: number }
  insertChar(char, position) {
    if (position.line === this.struct.length) {
      this.struct.push([])
    }

    if (char.value === '\n') {
      const lineAfter = this.struct[position.line].splice(position.ch)

      if (lineAfter.length === 0) {
        this.struct[position.line].splice(position.ch, 0, char)
      } else {
        const lineBefore = this.struct[position.line].concat(char)
        this.struct.splice(position.line, 1, lineBefore, lineAfter)
      }
    } else {
      this.struct[position.line].splice(position.ch, 0, char)
    }
  }

  localInsert(value, position) {
    const char = this.generateChar(value, position)
    this.insertChar(char, position)
    // broadcast insertion
  }

  remoteInsert(char) {
    const position = this.findInsertPosition(char)
    this.insertChar(char, position)
    // insert into editor
  }

  localDelete(startPosition, endPosition) {
    let chars
    let newlineRemoved = false

    // multi-line delete
    if (startPosition.line !== endPosition.line) {
      newlineRemoved = true
      chars = this.deleteMultipleLines(startPosition, endPosition)
    } else { // single-line delete
      chars = this.deleteSingleLine(startPosition, endPosition)

      if (chars.find(char => char.value === '\n')) {
        newlineRemoved = true
      }
    }

    // broadcast chars
    this.removeEmptyLines()

    if (newlineRemoved && this.struct[startPosition.line + 1]) {
      this.mergeLines(startPosition.line)
    }
  }

  remoteDelete(char, siteId) {
    const position = this.findPosition(char)

    if (!position) {
      return
    }

    this.struct[position.line].splice(position.ch, 1)

    if (char.value === '\n' && this.struct[position.line +1]) {
      this.mergeLines(position.line)
    }

    this.removeEmptyLines()
    // delete from editor
  }

  deleteSingleLine(startPosition, endPosition) {
    const count = endPosition.ch - startPosition.ch
    const chars = this.struct[startPosition.line].splice(startPosition.ch, count)
    return chars
  }

  deleteMultipleLines(startPosition, endPosition) {
    let chars = this.struct[startPosition.line].splice(startPosition.ch)

    for (let line = startPosition.line + 1; line < endPosition.line; line++) {
      chars = chars.concat(this.struct[line].splice(0))
    }

    if (this.struct[endPosition.line]) {
      chars = chars.concat(this.struct[endPosition.line].splice(0, endPosition.ch))
    }

    return chars
  }

  mergeLines(line) {
    const mergedLine = this.struct[line].concat(this.struct[line + 1])
    this.struct.splice(line, 2, mergedLine)
  }

  removeEmptyLines() {
    for (let line = 0; line < this.struct.length; line++) {
      if (this.struct[line].length === 0) {
        this.struct.splice(line, 1)
        line--
      }
    }

    if (this.struct.length === 0) {
      this.struct.push([])
    }
  }

  generateChar(value, position) {
    const positionBefore = this.findPositionBefore(position)
    const positionAfter = this.findPositionAfter(position)
    const newPosition = this.generatePositionBetween(positionBefore, positionAfter)

    return new Char(value, _, this.siteId, newPosition)
  }

  findPositionBefore(position) {
    let ch = position.ch
    let line = position.line

    if (ch === 0 && line === 0) {
      return []
    } else if (ch === 0 && line !== 0) {
      line = line - 1
      ch = this.struct[line].length
    }

    return this.struct[line][ch - 1].position
  }

  findPositionAfter(position) {
    let ch = position.ch
    let line = position.line

    const countLines = this.struct.length
    const countChars = this.struct[line].length

    if ((line === countLines - 1) && (ch === countChars)) {
      return []
    } else if ((line < countLines - 1) && (ch === countChars)) {
      line = line + 1
      ch = 0
    } else if ((line > countLines) && (ch === 0)) {
      return []
    }

    return this.struct[line][ch].position
  }

  generatePositionBetween(positionBefore, positionAfter, newPosition = [], level = 0) {
    let base = Math.pow(2, level) * this.base
    let boundaryStrategy = this.retrieveStrategy(level)

    let id1 = positionBefore[0] || new Identifier(0, this.siteId)
    let id2 = positionAfter[0] || new Identifier(base, this.siteId)

    if (id2.digit - id1.digit > 1) {
      let newDigit = this.generateIdBetween(id1.digit, id2.digit, boundaryStrategy)
      newPosition.push(new Identifier(newDigit, this.siteId))
      return newPosition
    } else if (id2.digit - id1.digit === 1) {
      newPosition.push(id1)
      return this.generatePositionBetween(positionBefore.slice(1), [], newPosition, level + 1)
    } else if (id1.digit === id2.digit) {
      if (id1.siteId < id2.siteId) {
        newPosition.push(id1)
        return this.generatePositionBetween(positionBefore.slice(1), [], newPosition, level + 1)
      } else if (id1.siteId === id2.siteId) {
        newPosition.push(id1)
        return this.generatePositionBetween(positionBefore.slice(1), positionAfters.slice(1), newPosition, level + 1)
      } else {
        throw new Error("Fix Position Sorting")
      }
    }
  }

  retrieveStrategy(level) {
    let strategy;

    if (this.strategyCache[level]) {
      return this.strategyCache[level]
    }

    switch (this.strategy) {
      case 'plus':
        strategy = '+'
      case 'minus':
        strategy = '-'
      case 'random':
        strategy = Math.round(Math.random()) === 0 ? '+' : '-'
      default:
        strategy = (level % 2) === 0 ? '+' : '-'
    }

    this.strategyCache[level] = strategy
    return strategy
  }

  generateIdBetween(min, max, boundaryStrategy) {
    if ((max - min) < this.boundary) {
      min = min + 1
    } else {
      if (boundaryStrategy === '-') {
        min = max - this.boundary
      } else {
        min = min + 1
        max = min + this.boundary
      }
    }

    return Math.floor(Math.random() * (max - min)) + min
  }

  findInsertPosition(char) {
    let minLine = 0;
    let totalLines = this.struct.length
    let maxLine = totalLines - 1
    let lastLine = this.struct[maxLine]
    let currentLine,
        midLine,
        charIdx,
        minCurrentLine,
        lastChar,
        maxCurrentLine,
        minLastChar,
        maxLastChar

    if (this.isEmpty() || char.compareTo(this.struct[0][0]) <= 0) {
      return { line: 0, ch: 0 }
    }

    lastChar = lastLine[lastLine.length - 1]

    if (char.compareTo(lastChar) > 0) {
      return this.findEndPosition(lastChar, lastLine, totalLines)
    }

    while (minLine + 1 < maxLine) {
      midLine = Math.floor(minLine + (maxLine - minLine) / 2)
      currentLine = this.struct[midLine]
      lastChar = currentLine[currentLine.length - 1]

      if (char.compareTo(lastChar) === 0) {
        return { line: midLine, ch: currentLine.length - 1 }
      } else if (char.compareTo(lastChar) < 0) {
        maxLine = midLine
      } else {
        minLine = midLine
      }
    }

    minCurrentLine = this.struct[minLine]
    minLastChar = minCurrentLine[minCurrentLine.length - 1]
    maxCurrentLine = this.struct[maxLine]
    maxLastChar = maxCurrentLine[maxCurrentLine.length - 1]

    if (char.compareTo(minLastChar) <= 0) {
      charIdx = this.findInsertIndexInLine(char, minCurrentLine)
      return { line: minLine, ch: charIdx }
    } else {
      charIdx = this.findInsertIndexInLine(char, maxCurrentLine)
      return { line: maxLine, ch: charIdx }
    }
  }

  isEmpty() {
    return this.struct.length === 1 && this.struct[0].length === 0
  }

  findEndPosition(lastChar, lastLine, totalLines) {
    if (lastChar.value === '\n') {
      return { line: totalLines, ch: 0 }
    } else {
      return { line: totalLines - 1, ch: lastLine.length }
    }
  }

  findInsertIndexInLine(char, line) {
    let left = 0
    let right = line.length - 1
    let mid, compareNum

    if (line.length === 0 || char.compareTo(line[left]) < 0) {
      return left
    } else if (char.compareTo(line[right]) > 0) {
      return this.struct.length
    }

    while (left + 1 < right) {
      mid = Math.floor(left + (right - left) / 2)
      compareNum = char.compareTo(line[mid])

      if (compareNum === 0) {
        return mid
      } else if (compareNum > 0) {
        left = mid
      } else {
        right = mid
      }
    }

    if (char.compareTo(line[left]) === 0) {
      return left
    } else {
      return right
    }
  }

  findPosition() {

  }
}

export default CRDT