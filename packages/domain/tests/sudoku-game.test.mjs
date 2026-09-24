import test from 'node:test';
import assert from 'node:assert/strict';
import {generateGamePuzzle,countGameSolutions,createSudokuGame,applySudokuAction,parseSudokuGame,isSudokuGameComplete,sudokuBoxDimensions} from '../dist/index.js';

for (const size of [4,6,9]) for(const difficulty of ['easy','medium','hard']) {
  test(`${size} ${difficulty}: deterministic, valid and uniquely solvable`,()=>{
    const puzzle=generateGamePuzzle(size,difficulty,1171);
    assert.deepEqual(puzzle,generateGamePuzzle(size,difficulty,1171));
    assert.equal(countGameSolutions(puzzle.givens,size),1);
    const expected=Array.from({length:size},(_,i)=>i+1).join(',');
    const sorted=v=>[...v].sort((a,b)=>a-b).join(',');
    const [height,width]=sudokuBoxDimensions(size);
    for(let r=0;r<size;r++) {
      assert.equal(sorted(puzzle.solution.slice(r*size,(r+1)*size)),expected);
      assert.equal(sorted(puzzle.solution.filter((_,i)=>i%size===r)),expected);
    }
    for(let r=0;r<size;r+=height)for(let c=0;c<size;c+=width){
      const box=[];for(let dr=0;dr<height;dr++)for(let dc=0;dc<width;dc++)box.push(puzzle.solution[(r+dr)*size+c+dc]);
      assert.equal(sorted(box),expected);
    }
    assert.ok(puzzle.givens.includes(0));
    assert.ok(puzzle.givens.every((v,i)=>v===0||v===puzzle.solution[i]));
    assert.notDeepEqual(puzzle,generateGamePuzzle(size,difficulty,1172));
  });
}
test('solver distinguishes invalid, ambiguous and exhausted searches',()=>{
  assert.equal(countGameSolutions(Array(16).fill(0),4),2);
  assert.equal(countGameSolutions([1,1,...Array(14).fill(0)],4),0);
  assert.equal(countGameSolutions(generateGamePuzzle(9,'hard',3).givens,9,0),2);
});
test('givens immutable, notes/history bounded, mistakes not erased by undo',()=>{
  let game=createSudokuGame(generateGamePuzzle(4,'medium',14));
  const index=game.values.indexOf(0), fixed=game.values.findIndex(v=>v!==0);
  assert.equal(applySudokuAction(game,{type:'erase',index:fixed}),game);
  game=applySudokuAction(game,{type:'digit',index,value:2,notes:true});
  assert.deepEqual(game.notes[index],[2]);
  const noted=game;
  game=applySudokuAction(game,{type:'digit',index,value:game.puzzle.solution[index]%4+1});
  assert.equal(game.mistakes,1);
  assert.deepEqual(game.notes[index],[]);
  game=applySudokuAction(game,{type:'undo'});
  assert.deepEqual(game.values,noted.values);assert.deepEqual(game.notes,noted.notes);assert.equal(game.mistakes,1);
  game=applySudokuAction(game,{type:'redo'});assert.notEqual(game.values[index],0);
  game=applySudokuAction(game,{type:'undo'});
  game=applySudokuAction(game,{type:'hint',index});assert.equal(game.values[index],game.puzzle.solution[index]);assert.equal(game.hints,1);assert.deepEqual(game.future,[]);
  assert.equal(applySudokuAction(game,{type:'hint',index}),game);
});
test('timer pauses and completion stops clock; undo reopens completed game',()=>{
  let game=createSudokuGame(generateGamePuzzle(4,'easy',7));
  game=applySudokuAction(game,{type:'tick',seconds:12});
  game=applySudokuAction(game,{type:'pause'});
  assert.equal(applySudokuAction(game,{type:'tick',seconds:60}),game);
  assert.equal(applySudokuAction(game,{type:'hint'}),game);
  game=applySudokuAction(game,{type:'resume'});
  while(!isSudokuGameComplete(game))game=applySudokuAction(game,{type:'hint'});
  assert.equal(game.elapsedSeconds,12);assert.equal(applySudokuAction(game,{type:'tick',seconds:10}),game);
  game=applySudokuAction(game,{type:'undo'});assert.equal(isSudokuGameComplete(game),false);
});
test('saved games validate givens, solution, notes, numbers and every history frame',()=>{
  const original=applySudokuAction(createSudokuGame(generateGamePuzzle(6,'hard',3)),{type:'hint'});
  assert.deepEqual(parseSudokuGame(JSON.parse(JSON.stringify(original))),original);
  const corruptions=[g=>{g.version=2},g=>{g.puzzle.solution[0]=0},g=>{g.values[g.puzzle.givens.findIndex(v=>v!==0)]=0},g=>{g.notes[0]=[NaN]},g=>{g.elapsedSeconds=-1},g=>{g.history[0].values=[]},g=>{g.future=Array(101).fill(g.history[0])},g=>{g.puzzle.givens.fill(0)}];
  for(const corrupt of corruptions){const g=structuredClone(original);corrupt(g);assert.equal(parseSudokuGame(g),null);}
  assert.equal(parseSudokuGame(null),null);assert.equal(parseSudokuGame({}),null);
});
test('bounded history and invalid actions cannot change the game',()=>{
  let game=createSudokuGame(generateGamePuzzle(4,'easy',55));
  const index=game.values.indexOf(0);
  for(const action of [{type:'digit',index:-1,value:1},{type:'digit',index,value:5},{type:'digit',index,value:NaN},{type:'tick',seconds:Infinity}])assert.equal(applySudokuAction(game,action),game);
  for(let i=0;i<110;i++)game=applySudokuAction(game,{type:'digit',index,value:1,notes:true});
  assert.equal(game.history.length,100);
  game=applySudokuAction(game,{type:'hint',index});
  const mistakes=game.mistakes,hints=game.hints;
  game=applySudokuAction(game,{type:'clear'});
  assert.deepEqual(game.values,game.puzzle.givens);assert.equal(game.mistakes,mistakes);assert.equal(game.hints,hints);
  assert.ok(parseSudokuGame(game));
});
